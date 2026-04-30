// Package app — intelligence use cases. Pure orchestrators wiring the
// reader-adapters + LLM synthesiser + cache repo. No HTTP / proto types.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// CacheTTL — кеш дневного брифа. 6 часов покрывает «утренняя сессия →
// обед → вечер» без перегенераций; за пределами окна юзер скорее всего
// уже накопил новые reflection'ы и стоит пересчитать.
const CacheTTL = 6 * time.Hour

// ForceCooldown — минимальный интервал между принудительными regenerate'ами.
// 1 час не даёт нагенерировать ⌘R-спамом и не сжигает LLM-квоту.
const ForceCooldown = time.Hour

// GetDailyBrief — use case для GetDailyBrief RPC.
type GetDailyBrief struct {
	Briefs      domain.DailyBriefRepo
	Focus       domain.FocusReader
	Plans       domain.PlanReader
	Notes       domain.NotesReader
	Synthesiser domain.BriefSynthesizer
	Log         *slog.Logger
	Now         func() time.Time
	// Memory — optional. С ним brief получает «past coach interactions»
	// в prompt и каждое generated brief пишется как brief_emitted episode.
	Memory *Memory

	// ── Cross-product readers (все nullable) ──
	//
	// Все шесть — opt-in. Если nil, соответствующая секция prompt'а
	// просто не наполняется. Это позволяет частичный rollout: сначала
	// поднимаем Mocks, потом добавляем Arena, и т.д.
	Mocks        domain.MockReader
	Kata         domain.KataReader
	Arena        domain.ArenaReader
	Queue        domain.QueueReader
	Skills       domain.SkillReader
	DailyNotes   domain.DailyNoteReader
	Calendar     domain.CalendarReader
	MockMessages domain.MockMessagesReader
	Codex        domain.CodexReader
	// Tracks — Phase 2d. Reads the user's active learning tracks so
	// the coach can flag stalled tracks and pin recommendations to the
	// current step's skill_keys. nil-safe.
	Tracks domain.TrackReader

	// Goals — Phase 4.3. User's active high-level goals (job/skill/track).
	// nil-safe: пустой goals reader → coach просто не видит секцию,
	// поведение существующих briefs не меняется.
	Goals domain.GoalsReader

	// Clubs — Phase 3 final. Reads "ghosted club sessions" сигнал
	// (юзер RSVP'нул, не дошёл). nil-safe.
	Clubs domain.ClubReader

	// Insights — Phase 1.5b. nil-safe. When set, the brief use-case
	// passes the same prompt-input snapshot to the insight generator
	// after synthesise — so both surfaces (full DailyBrief + atomic
	// insight cards) reflect the same world-state without re-fetching
	// any of the readers above.
	Insights *GenerateInsights
}

// GetDailyBriefInput — параметры use case'а.
type GetDailyBriefInput struct {
	UserID uuid.UUID
	Force  bool
}

// Do возвращает кешированный (или свежесинтезированный) бриф.
//
// Cache flow:
//  1. force=false  → cache hit < CacheTTL → return.
//  2. force=true   → проверяем cooldown (1h с предыдущей generated_at);
//     нарушен → ErrRateLimited.
//  3. cache miss / force valid → собираем prompt-input + вызываем
//     Synthesise + Upsert + return.
//
// Anti-fallback: при ErrLLMUnavailable use-case проксирует ошибку
// неизменной — клиент покажет «Coach is offline», а не fake brief.
func (uc *GetDailyBrief) Do(ctx context.Context, in GetDailyBriefInput) (domain.DailyBrief, error) {
	now := uc.Now().UTC()
	today := now.Truncate(24 * time.Hour)

	// 1. Try cache.
	if !in.Force {
		cached, err := uc.Briefs.GetForDate(ctx, in.UserID, today)
		if err == nil {
			freshEnough, freshnessErr := uc.cacheFreshEnough(ctx, in.UserID, cached.GeneratedAt, now)
			if freshnessErr != nil {
				return domain.DailyBrief{}, freshnessErr
			}
			if freshEnough {
				return cached, nil
			}
		} else if !errors.Is(err, domain.ErrNotFound) {
			return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: cache lookup: %w", err)
		}
	}

	// 2. Force cooldown gate.
	if in.Force {
		last, err := uc.Briefs.LastForcedAt(ctx, in.UserID)
		if err != nil {
			return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: lastForcedAt: %w", err)
		}
		if !last.IsZero() && now.Sub(last) < ForceCooldown {
			return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: %w", domain.ErrRateLimited)
		}
	}

	// 3. Build prompt input.
	since14 := today.Add(-14 * 24 * time.Hour)
	since7 := today.Add(-7 * 24 * time.Hour)

	var (
		focus     []domain.FocusDay
		skipped   []domain.SkippedPlanItem
		completed []domain.CompletedPlanItem
		refl      []domain.Reflection
		recent    []domain.NoteHead

		focusErr     error
		skippedErr   error
		completedErr error
		reflErr      error
		recentErr    error
	)
	var wg sync.WaitGroup
	wg.Add(5)
	go func() {
		defer wg.Done()
		focus, focusErr = uc.Focus.LastNDays(ctx, in.UserID, 7)
	}()
	go func() {
		defer wg.Done()
		skipped, skippedErr = uc.Plans.SkippedItems(ctx, in.UserID, since14)
	}()
	go func() {
		defer wg.Done()
		completed, completedErr = uc.Plans.CompletedItems(ctx, in.UserID, since7)
	}()
	go func() {
		defer wg.Done()
		refl, reflErr = uc.Notes.RecentReflections(ctx, in.UserID, 5)
	}()
	go func() {
		defer wg.Done()
		recent, recentErr = uc.Notes.RecentNotes(ctx, in.UserID, 8)
	}()
	wg.Wait()
	if focusErr != nil {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: focus: %w", focusErr)
	}
	if skippedErr != nil {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: skipped: %w", skippedErr)
	}
	if completedErr != nil {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: completed: %w", completedErr)
	}
	if reflErr != nil {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: reflections: %w", reflErr)
	}
	if recentErr != nil {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: recent notes: %w", recentErr)
	}

	var (
		mocks           []domain.MockSessionSummary
		kataStreak      domain.KataStreak
		kataRecent      []domain.KataAttempt
		arena           []domain.ArenaMatchSummary
		queue           domain.QueueSnapshot
		weakSkills      []domain.SkillWeak
		dailyNotes      []domain.DailyNoteHead
		upcoming        []domain.UpcomingInterview
		keywords        []domain.MockKeywords
		tracks          []domain.ActiveTrack
		goals           []domain.UserGoal
		ghostedClubs    []domain.GhostedClubSession
		abandonedRecent int
	)

	var optionalWG sync.WaitGroup
	if uc.Mocks != nil {
		optionalWG.Add(1)
		go func() {
			defer optionalWG.Done()
			if v, err := uc.Mocks.LastNFinished(ctx, in.UserID, 5); err == nil {
				mocks = v
			} else {
				warnReader(uc.Log, "mocks", err)
			}
			// Phase 4.7 — abandoned-mock counter (consistency-break сигнал).
			// 14d window matches «recent» horizon other readers используют.
			if v, err := uc.Mocks.RecentAbandonedCount(ctx, in.UserID, 14); err == nil {
				abandonedRecent = v
			} else {
				warnReader(uc.Log, "mocks_abandoned", err)
			}
		}()
	}
	if uc.Kata != nil {
		optionalWG.Add(1)
		go func() {
			defer optionalWG.Done()
			if v, err := uc.Kata.GetStreak(ctx, in.UserID); err == nil {
				kataStreak = v
			} else {
				warnReader(uc.Log, "kata_streak", err)
			}
			if v, err := uc.Kata.LastNAttempts(ctx, in.UserID, 7); err == nil {
				kataRecent = v
			} else {
				warnReader(uc.Log, "kata_recent", err)
			}
		}()
	}
	if uc.Arena != nil {
		optionalWG.Add(1)
		go func() {
			defer optionalWG.Done()
			if v, err := uc.Arena.LastNMatches(ctx, in.UserID, 5); err == nil {
				arena = v
			} else {
				warnReader(uc.Log, "arena", err)
			}
		}()
	}
	if uc.Queue != nil {
		optionalWG.Add(1)
		go func() {
			defer optionalWG.Done()
			if v, err := uc.Queue.TodaySnapshot(ctx, in.UserID); err == nil {
				queue = v
			} else {
				warnReader(uc.Log, "queue", err)
			}
		}()
	}
	if uc.Skills != nil {
		optionalWG.Add(1)
		go func() {
			defer optionalWG.Done()
			if v, err := uc.Skills.WeakestN(ctx, in.UserID, 5); err == nil {
				weakSkills = v
			} else {
				warnReader(uc.Log, "skills", err)
			}
		}()
	}
	if uc.DailyNotes != nil {
		optionalWG.Add(1)
		go func() {
			defer optionalWG.Done()
			if v, err := uc.DailyNotes.RecentDailyNotes(ctx, in.UserID, 3); err == nil {
				dailyNotes = v
			} else {
				warnReader(uc.Log, "daily_notes", err)
			}
		}()
	}
	if uc.Calendar != nil {
		optionalWG.Add(1)
		go func() {
			defer optionalWG.Done()
			if v, err := uc.Calendar.UpcomingInterviews(ctx, in.UserID, 30); err == nil {
				upcoming = v
			} else {
				warnReader(uc.Log, "calendar", err)
			}
		}()
	}
	if uc.MockMessages != nil {
		optionalWG.Add(1)
		go func() {
			defer optionalWG.Done()
			if v, err := uc.MockMessages.TopKeywords(ctx, in.UserID, 14, 12); err == nil {
				keywords = v
			} else {
				warnReader(uc.Log, "mock_messages", err)
			}
		}()
	}
	if uc.Tracks != nil {
		optionalWG.Add(1)
		go func() {
			defer optionalWG.Done()
			if v, err := uc.Tracks.ActiveTracks(ctx, in.UserID); err == nil {
				tracks = v
			} else {
				warnReader(uc.Log, "tracks", err)
			}
		}()
	}
	if uc.Goals != nil {
		optionalWG.Add(1)
		go func() {
			defer optionalWG.Done()
			if v, err := uc.Goals.ActiveGoals(ctx, in.UserID); err == nil {
				goals = v
			} else {
				warnReader(uc.Log, "goals", err)
			}
		}()
	}
	if uc.Clubs != nil {
		optionalWG.Add(1)
		go func() {
			defer optionalWG.Done()
			if v, err := uc.Clubs.GhostedSessions(ctx, in.UserID, 7); err == nil {
				ghostedClubs = v
			} else {
				warnReader(uc.Log, "clubs", err)
			}
		}()
	}
	optionalWG.Wait()
	recent = freshRecentNotesForBrief(recent, today)
	dailyNotes = freshDailyNotesForBrief(dailyNotes, today)

	var (
		pastEpisodes []domain.Episode
		cueMemories  []domain.Episode
	)
	if uc.Memory != nil {
		recallQuery := briefMemoryRecallQuery(
			upcoming, mocks, weakSkills, keywords, arena, queue, skipped, recent, dailyNotes,
		)
		var memoryWG sync.WaitGroup
		memoryWG.Add(2)
		go func() {
			defer memoryWG.Done()
			if recall, err := uc.Memory.Recall(ctx, RecallParams{
				UserID: in.UserID,
				Query:  recallQuery,
				Kinds: []domain.EpisodeKind{
					domain.EpisodeBriefEmitted,
					domain.EpisodeBriefFollowed,
					domain.EpisodeBriefDismissed,
					domain.EpisodeQAQuery,
					domain.EpisodeQAAnswered,
				},
				// Tighter than the historical 60-day window: older brief
				// signals lead to recommendations referencing what the user
				// solved weeks ago and create the "coach feels stale" UX
				// the rebuild was prompted by.
				SinceDays:     30,
				K:             4,
				PerKindRecent: 3,
			}); err == nil {
				pastEpisodes = recall
			} else {
				warnReader(uc.Log, "memory", err)
			}
		}()
		go func() {
			defer memoryWG.Done()
			if recall, err := uc.Memory.Recall(ctx, RecallParams{
				UserID:        in.UserID,
				Query:         recallQuery,
				Kinds:         []domain.EpisodeKind{domain.EpisodeCueConversationMemory},
				SinceDays:     14,
				K:             6,
				PerKindRecent: 8,
			}); err == nil {
				cueMemories = selectCueMemories(recall, 5)
			} else {
				warnReader(uc.Log, "cue_memory", err)
			}
		}()
		memoryWG.Wait()
	}
	var codexArticles []domain.CodexArticleSuggestion
	if uc.Codex != nil {
		if v, cErr := uc.Codex.SuggestArticles(ctx, in.UserID, codexTopicsForBrief(
			mocks, weakSkills, keywords, arena, cueMemories,
		), 6); cErr == nil {
			codexArticles = v
		} else {
			warnReader(uc.Log, "codex", cErr)
		}
	}

	// Phase 4.8 — pending follow-ups derived from recently-followed
	// brief_emitted episodes. Coach sees «вчера юзер кликнул X» и
	// должен спросить «landed ли X?» в next brief.
	pendingFollowups := computePendingFollowups(pastEpisodes, now, 36)

	snapshot := domain.BriefPromptInput{
		UserID:              in.UserID,
		Today:               today,
		FocusDays:           focus,
		SkippedRecent:       skipped,
		CompletedRecent:     completed,
		Reflections:         refl,
		RecentNotes:         recent,
		PastEpisodes:        pastEpisodes,
		CueMemories:         cueMemories,
		Mocks:               mocks,
		MockAbandonedRecent: abandonedRecent,
		KataStreak:          kataStreak,
		KataRecent:          kataRecent,
		Arena:               arena,
		Queue:               queue,
		WeakSkills:          weakSkills,
		DailyNotes:          dailyNotes,
		UpcomingInterviews:  upcoming,
		MockKeywords:        keywords,
		CodexArticles:       codexArticles,
		ActiveTracks:        tracks,
		PendingFollowups:    pendingFollowups,
		ActiveGoals:         goals,
		GhostedClubs:        ghostedClubs,
	}
	brief, err := uc.Synthesiser.Synthesise(ctx, snapshot)
	if err != nil {
		// Pass-through — пусть transport сам решит как 503-ить.
		return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: synthesise: %w", err)
	}
	brief.GeneratedAt = now
	if brief.BriefID == uuid.Nil && uc.Memory != nil {
		brief.BriefID = uuid.New()
	}
	if uc.Memory != nil && brief.BriefID != uuid.Nil {
		if err := rememberBriefEmitted(ctx, uc.Memory, in.UserID, brief); err != nil {
			uc.Log.Warn("intelligence.GetDailyBrief.Do: brief memory append failed",
				slog.Any("err", err), slog.String("user_id", in.UserID.String()))
			brief.BriefID = uuid.Nil
		}
	}

	if err := uc.Briefs.Upsert(ctx, in.UserID, today, brief); err != nil {
		// Cache-write fail — НЕ блокируем юзера. Бриф уже синтезирован,
		// возвращаем его; следующий вызов просто пере-синтезирует. Логируем
		// чтобы оператор видел persistent-faults.
		uc.Log.Warn("intelligence.GetDailyBrief.Do: cache upsert failed",
			slog.Any("err", err), slog.String("user_id", in.UserID.String()))
	}
	// Phase 1.5b — share the same snapshot with the insight generator.
	// Runs in a detached goroutine so the brief's RPC latency stays
	// untouched: insight production is a side-effect (writes to its own
	// table via Upsert) and never blocks the user.
	if uc.Insights != nil {
		go func(s domain.BriefPromptInput) {
			// Disconnected ctx — request ctx may be cancelled the moment
			// the brief response is flushed. We give the generator its
			// own short window so DB writes don't get torn.
			bgCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if _, err := uc.Insights.Do(bgCtx, GenerateInsightsInput{
				UserID:   in.UserID,
				Snapshot: s,
			}); err != nil {
				uc.Log.Warn("intelligence.GetDailyBrief.Do: insight generation failed",
					slog.Any("err", err), slog.String("user_id", in.UserID.String()))
			}
		}(snapshot)
	}
	return brief, nil
}

func (uc *GetDailyBrief) cacheFreshEnough(
	ctx context.Context,
	userID uuid.UUID,
	generatedAt time.Time,
	now time.Time,
) (bool, error) {
	if now.Sub(generatedAt) >= CacheTTL {
		return false, nil
	}
	if uc.Memory == nil || uc.Memory.Episodes == nil {
		return true, nil
	}
	events, err := uc.Memory.Episodes.LatestByKinds(ctx, userID, briefFreshnessEpisodeKinds(), 1)
	if err != nil {
		return false, fmt.Errorf("intelligence.GetDailyBrief.Do: freshness episodes: %w", err)
	}
	if len(events) == 0 {
		return true, nil
	}
	return !events[0].OccurredAt.After(generatedAt), nil
}

func briefFreshnessEpisodeKinds() []domain.EpisodeKind {
	return []domain.EpisodeKind{
		domain.EpisodeReflectionAdded,
		domain.EpisodeStandupRecorded,
		domain.EpisodePlanSkipped,
		domain.EpisodePlanCompleted,
		domain.EpisodeNoteCreated,
		domain.EpisodeFocusSessionDone,
		domain.EpisodeMockPipelineFinished,
		domain.EpisodeCodexArticleOpened,
		domain.EpisodeCueConversationMemory,
	}
}

func freshRecentNotesForBrief(notes []domain.NoteHead, today time.Time) []domain.NoteHead {
	if len(notes) == 0 {
		return nil
	}
	freshSince := today.Add(-48 * time.Hour)
	out := make([]domain.NoteHead, 0, len(notes))
	for _, note := range notes {
		title := strings.TrimSpace(strings.ToLower(note.Title))
		isStandup := strings.HasPrefix(title, "standup ")
		if isStandup && note.UpdatedAt.Before(today) {
			continue
		}
		if note.UpdatedAt.Before(freshSince) {
			continue
		}
		out = append(out, note)
	}
	if len(out) > 5 {
		out = out[:5]
	}
	return out
}

func freshDailyNotesForBrief(notes []domain.DailyNoteHead, today time.Time) []domain.DailyNoteHead {
	if len(notes) == 0 {
		return nil
	}
	freshSince := today.Add(-48 * time.Hour)
	out := make([]domain.DailyNoteHead, 0, len(notes))
	for _, note := range notes {
		if note.Day.Before(freshSince) {
			continue
		}
		out = append(out, note)
	}
	return out
}

type emittedBriefPayload struct {
	BriefID         string                       `json:"brief_id"`
	Headline        string                       `json:"headline"`
	Narrative       string                       `json:"narrative"`
	Recommendations []emittedBriefRecommendation `json:"recommendations"`
}

type emittedBriefRecommendation struct {
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	Rationale string `json:"rationale"`
	TargetID  string `json:"target_id,omitempty"`
}

func rememberBriefEmitted(ctx context.Context, memory *Memory, userID uuid.UUID, brief domain.DailyBrief) error {
	payload := emittedBriefPayload{
		BriefID:   brief.BriefID.String(),
		Headline:  brief.Headline,
		Narrative: brief.Narrative,
	}
	for _, rec := range brief.Recommendations {
		payload.Recommendations = append(payload.Recommendations, emittedBriefRecommendation{
			Kind:      string(rec.Kind),
			Title:     rec.Title,
			Rationale: rec.Rationale,
			TargetID:  rec.TargetID,
		})
	}
	return memory.Append(ctx, AppendInput{
		UserID:     userID,
		Kind:       domain.EpisodeBriefEmitted,
		Summary:    emittedBriefSummary(brief),
		Payload:    payload,
		OccurredAt: brief.GeneratedAt,
	})
}

func emittedBriefSummary(brief domain.DailyBrief) string {
	parts := make([]string, 0, len(brief.Recommendations)+1)
	if headline := strings.TrimSpace(brief.Headline); headline != "" {
		parts = append(parts, headline)
	}
	for _, rec := range brief.Recommendations {
		if title := strings.TrimSpace(rec.Title); title != "" {
			parts = append(parts, title)
		}
	}
	return strings.Join(parts, " | ")
}

func warnReader(log *slog.Logger, name string, err error) {
	if log == nil || err == nil {
		return
	}
	log.Warn("intelligence.GetDailyBrief: reader failed",
		slog.String("reader", name),
		slog.Any("err", err))
}

func briefMemoryRecallQuery(
	upcoming []domain.UpcomingInterview,
	mocks []domain.MockSessionSummary,
	weakSkills []domain.SkillWeak,
	keywords []domain.MockKeywords,
	arena []domain.ArenaMatchSummary,
	queue domain.QueueSnapshot,
	skipped []domain.SkippedPlanItem,
	recent []domain.NoteHead,
	dailyNotes []domain.DailyNoteHead,
) string {
	seen := make(map[string]struct{}, 32)
	parts := make([]string, 0, 32)
	add := func(s string) {
		s = strings.TrimSpace(strings.ToLower(s))
		if s == "" {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		parts = append(parts, s)
	}
	for _, ui := range upcoming {
		if ui.DaysFromNow < 0 || ui.DaysFromNow > 30 {
			continue
		}
		add(ui.CompanyName)
		add(ui.Role)
		add(ui.CurrentLevel)
	}
	for _, m := range mocks {
		add(m.Section)
		for _, w := range m.WeakTopics {
			add(w)
		}
	}
	for _, w := range weakSkills {
		add(w.SkillKey)
		add(w.Title)
	}
	for _, kw := range keywords {
		add(kw.Keyword)
	}
	for _, a := range arena {
		add(a.Section)
	}
	for _, item := range queue.Items {
		add(item.SkillKey)
		add(item.Title)
	}
	for _, item := range skipped {
		add(item.SkillKey)
		add(item.Title)
	}
	for _, note := range recent {
		add(note.Title)
		add(firstWords(note.Excerpt, 16))
	}
	for _, note := range dailyNotes {
		add(firstWords(note.Excerpt, 16))
	}
	if len(parts) > 32 {
		parts = parts[:32]
	}
	return strings.Join(parts, " ")
}

func firstWords(s string, limit int) string {
	if limit <= 0 {
		return ""
	}
	words := strings.Fields(strings.TrimSpace(s))
	if len(words) <= limit {
		return strings.Join(words, " ")
	}
	return strings.Join(words[:limit], " ")
}

func codexTopicsForBrief(
	mocks []domain.MockSessionSummary,
	weakSkills []domain.SkillWeak,
	keywords []domain.MockKeywords,
	arena []domain.ArenaMatchSummary,
	cue []domain.Episode,
) []string {
	seen := make(map[string]struct{}, 32)
	out := make([]string, 0, 16)
	add := func(s string) {
		s = strings.TrimSpace(strings.ToLower(s))
		if s == "" {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	for _, m := range mocks {
		add(m.Section)
		for _, w := range m.WeakTopics {
			add(w)
		}
	}
	for _, w := range weakSkills {
		add(w.SkillKey)
		add(w.Title)
	}
	for _, kw := range keywords {
		add(kw.Keyword)
	}
	for _, a := range arena {
		add(a.Section)
	}
	for _, ep := range cue {
		p, ok := parseCueMemoryPayload(ep.Payload)
		if !ok {
			continue
		}
		for _, t := range p.Topics {
			add(t)
		}
	}
	return out
}

type cueMemoryPayload struct {
	Outcome           string   `json:"outcome"`
	Topics            []string `json:"topics"`
	RollingSummary    string   `json:"rolling_summary"`
	ScreenshotSummary string   `json:"screenshot_summary"`
}

func selectCueMemories(rows []domain.Episode, limit int) []domain.Episode {
	if limit <= 0 {
		return nil
	}
	out := make([]domain.Episode, 0, limit)
	seen := make(map[string]struct{}, limit)
	for _, ep := range rows {
		p, ok := parseCueMemoryPayload(ep.Payload)
		if !ok || !cueOutcomeUseful(p.Outcome) {
			continue
		}
		summary := strings.TrimSpace(p.RollingSummary)
		if summary == "" {
			summary = strings.TrimSpace(ep.Summary)
		}
		if summary == "" || summary == "Cue conversation memory" {
			continue
		}
		key := strings.ToLower(summary)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		ep.Summary = summary
		out = append(out, ep)
		if len(out) >= limit {
			return out
		}
	}
	return out
}

func parseCueMemoryPayload(raw []byte) (cueMemoryPayload, bool) {
	if len(raw) == 0 {
		return cueMemoryPayload{}, false
	}
	var p cueMemoryPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return cueMemoryPayload{}, false
	}
	return p, true
}

func cueOutcomeUseful(outcome string) bool {
	switch strings.TrimSpace(outcome) {
	case "answered", "weak":
		return true
	default:
		return false
	}
}

// computePendingFollowups — Phase 4.8 closing-the-loop. Возвращает
// follow-ups: brief_followed эпизоды за последние windowHours, чьи
// titles/kinds должны попасть в next brief как «landed ли X?».
//
// Только actionable closables — review_note (read article) и tiny_task
// (solve drill). schedule = чистый timing, нечего спрашивать;
// unblock — обычно multi-day, не закрывается в одну ночь.
//
// Title берём из Episode.Summary; payload — formatting из
// app/memory.go AckRecommendation. Жёсткий cap на 3 чтобы prompt не
// разросся — coach-prompt and so already busy enough.
func computePendingFollowups(past []domain.Episode, now time.Time, windowHours int) []domain.PendingFollowup {
	if windowHours <= 0 {
		windowHours = 36
	}
	cutoff := now.Add(-time.Duration(windowHours) * time.Hour)
	out := make([]domain.PendingFollowup, 0, 3)
	for _, ep := range past {
		if ep.Kind != domain.EpisodeBriefFollowed {
			continue
		}
		if ep.OccurredAt.IsZero() || ep.OccurredAt.Before(cutoff) {
			continue
		}
		var p struct {
			RecKind  string `json:"rec_kind"`
			TargetID string `json:"target_id"`
		}
		_ = json.Unmarshal(ep.Payload, &p)
		kind := domain.RecommendationKind(strings.TrimSpace(p.RecKind))
		if kind != domain.RecommendationReviewNote && kind != domain.RecommendationTinyTask {
			continue
		}
		title := strings.TrimSpace(ep.Summary)
		if title == "" {
			continue
		}
		hours := int(now.Sub(ep.OccurredAt).Hours())
		if hours < 0 {
			hours = 0
		}
		out = append(out, domain.PendingFollowup{
			Title:      title,
			Kind:       kind,
			TargetID:   strings.TrimSpace(p.TargetID),
			FollowedAt: ep.OccurredAt,
			HoursAgo:   hours,
		})
		if len(out) >= 3 {
			break
		}
	}
	return out
}
