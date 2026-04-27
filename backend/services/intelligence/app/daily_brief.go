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
			if now.Sub(cached.GeneratedAt) < CacheTTL {
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
		recent, recentErr = uc.Notes.RecentNotes(ctx, in.UserID, 5)
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
		mocks      []domain.MockSessionSummary
		kataStreak domain.KataStreak
		kataRecent []domain.KataAttempt
		arena      []domain.ArenaMatchSummary
		queue      domain.QueueSnapshot
		weakSkills []domain.SkillWeak
		dailyNotes []domain.DailyNoteHead
		upcoming   []domain.UpcomingInterview
		keywords   []domain.MockKeywords
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
	optionalWG.Wait()

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
				SinceDays:     60,
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

	brief, err := uc.Synthesiser.Synthesise(ctx, domain.BriefPromptInput{
		UserID:             in.UserID,
		Today:              today,
		FocusDays:          focus,
		SkippedRecent:      skipped,
		CompletedRecent:    completed,
		Reflections:        refl,
		RecentNotes:        recent,
		PastEpisodes:       pastEpisodes,
		CueMemories:        cueMemories,
		Mocks:              mocks,
		KataStreak:         kataStreak,
		KataRecent:         kataRecent,
		Arena:              arena,
		Queue:              queue,
		WeakSkills:         weakSkills,
		DailyNotes:         dailyNotes,
		UpcomingInterviews: upcoming,
		MockKeywords:       keywords,
		CodexArticles:      codexArticles,
	})
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
	return brief, nil
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
