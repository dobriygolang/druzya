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

// AsyncSubmitter — bounded worker pool interface для detached side-
// effect work (insight generation после brief synth'а). nil-safe в
// caller'е: если nil — fallback на raw `go func()`.
//
// Не импортируем shared/pkg/workerpool сюда чтобы не тащить shared в
// intelligence-domain зависимости — interface достаточно узкий чтобы
// caller любой pool реализацией заинжектил.
type AsyncSubmitter interface {
	Submit(ctx context.Context, fn func(ctx context.Context)) bool
}

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
	// InsightsPool — optional bounded pool для async insight gen после
	// synth'а. nil → fallback на raw `go func()` (старое поведение,
	// 1 goroutine на request — рискованно при burst). Wired в bootstrap.
	InsightsPool AsyncSubmitter

	// ── Cross-product readers (все nullable) ──
	//
	// Все шесть — opt-in. Если nil, соответствующая секция prompt'а
	// просто не наполняется. Это позволяет частичный rollout: сначала
	// поднимаем Mocks, потом добавляем Arena, и т.д.
	Mocks        domain.MockReader
	Queue        domain.QueueReader
	Skills       domain.SkillReader
	DailyNotes   domain.DailyNoteReader
	MockMessages domain.MockMessagesReader
	Codex        domain.CodexReader
	// All readers below are nil-safe — пустой reader → секция просто
	// отсутствует в prompt'е, поведение existing briefs не меняется.
	Tracks    domain.TrackReader
	Goals     domain.GoalsReader
	Clubs     domain.ClubReader
	External  domain.ExternalActivityReader
	MLProfile domain.MLProfileReader
	// 24h activity (counts only) — surface context для «вчера ты сделал X»
	// framing. nil-safe.
	RecentActivity domain.RecentActivityReader
	// DayShutdown — вчерашняя запись end-of-day ритуала из Hone
	// (day_shutdowns). nil = section в prompt'е отсутствует.
	DayShutdown domain.DayShutdownReader

	// Insights — when set, the brief use-case passes the same prompt-input
	// snapshot to the insight generator after synthesise — so both surfaces
	// (full DailyBrief + atomic insight cards) reflect the same world-state
	// without re-fetching any of the readers above.
	Insights *GenerateInsights
}

// GetDailyBriefInput — параметры use case'а.
type GetDailyBriefInput struct {
	UserID uuid.UUID
	Force  bool
	// Source — surface awareness. Empty / "web" → default web-bias.
	// "hone" → bias toward focus session on a Hone task. "cue" → bias toward
	// interview prep if upcoming.
	Source string
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
	req, err := uc.loadRequiredFeed(ctx, in.UserID, today)
	if err != nil {
		return domain.DailyBrief{}, err
	}
	opt := uc.loadOptionalFeed(ctx, in.UserID)
	req.recent = freshRecentNotesForBrief(req.recent, today)
	opt.dailyNotes = freshDailyNotesForBrief(opt.dailyNotes, today)

	pastEpisodes, cueMemories := uc.loadMemoryRecall(ctx, in.UserID, req, opt)

	var codexArticles []domain.CodexArticleSuggestion
	if uc.Codex != nil {
		if v, cErr := uc.Codex.SuggestArticles(ctx, in.UserID, codexTopicsForBrief(
			opt.mocks, opt.weakSkills, opt.keywords, cueMemories,
		), 6); cErr == nil {
			codexArticles = v
		} else {
			warnReader(uc.Log, "codex", cErr)
		}
	}

	// Pending follow-ups derived from recently-followed brief_emitted
	// episodes. Coach sees «вчера юзер кликнул X» и должен спросить
	// «landed ли X?» в next brief.
	pendingFollowups := computePendingFollowups(pastEpisodes, now, 36)

	snapshot := domain.BriefPromptInput{
		UserID:              in.UserID,
		Today:               today,
		FocusDays:           req.focus,
		SkippedRecent:       req.skipped,
		CompletedRecent:     req.completed,
		Reflections:         req.refl,
		RecentNotes:         req.recent,
		PastEpisodes:        pastEpisodes,
		CueMemories:         cueMemories,
		Mocks:               opt.mocks,
		MockAbandonedRecent: opt.abandonedRecent,
		Queue:               opt.queue,
		WeakSkills:          opt.weakSkills,
		DailyNotes:          opt.dailyNotes,
		MockKeywords:        opt.keywords,
		CodexArticles:       codexArticles,
		ActiveTracks:        opt.tracks,
		PendingFollowups:    pendingFollowups,
		ActiveGoals:         opt.goals,
		GhostedClubs:        opt.ghostedClubs,
		External:            opt.external,
		ML:                  opt.mlProfile,
		DayShutdown:         opt.dayShutdown,
		Source:              in.Source,
		RecentActivity24h:   opt.recentActivity,
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
	// Share the same snapshot with the insight generator. Runs in a
	// detached goroutine so the brief's RPC latency stays untouched —
	// insight production is a side-effect (writes its own table via Upsert).
	//
	// InsightsPool, when wired, bounds concurrency на burst (1000 briefs
	// не должно становиться 1000 LLM goroutines). Drop с warn'ом если
	// pool full: insight cards отстают на цикл, brief сам валиден.
	if uc.Insights != nil {
		userID := in.UserID
		work := func(bgCtx context.Context) {
			if _, err := uc.Insights.Do(bgCtx, GenerateInsightsInput{
				UserID:   userID,
				Snapshot: snapshot,
			}); err != nil {
				uc.Log.Warn("intelligence.GetDailyBrief.Do: insight generation failed",
					slog.Any("err", err), slog.String("user_id", userID.String()))
			}
		}
		if uc.InsightsPool != nil {
			// Detached ctx с 30s timeout — request ctx может cancel'нуться
			// сразу после 200 OK, а нам ещё нужно writeать insight rows.
			bgCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			submitted := uc.InsightsPool.Submit(bgCtx, func(ctx context.Context) {
				defer cancel()
				work(ctx)
			})
			if !submitted {
				cancel()
				uc.Log.Warn("intelligence.GetDailyBrief.Do: insights pool full, deferred",
					slog.String("user_id", userID.String()))
			}
		} else {
			// Fallback: raw goroutine (старое поведение). Используется
			// в тестах где pool не wired.
			go func() {
				bgCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				work(bgCtx)
			}()
		}
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

// requiredFeed bundles the mandatory readers that must succeed для brief.
// Каждое поле — параллельно загружаемая выборка; ошибка любого → fail-fast.
type requiredFeed struct {
	focus     []domain.FocusDay
	skipped   []domain.SkippedPlanItem
	completed []domain.CompletedPlanItem
	refl      []domain.Reflection
	recent    []domain.NoteHead
}

// optionalFeed bundles fail-soft cross-product reader outputs. Любая
// ошибка просто warn'ит и оставляет zero value — соответствующая prompt
// секция просто не появится.
type optionalFeed struct {
	mocks           []domain.MockSessionSummary
	queue           domain.QueueSnapshot
	weakSkills      []domain.SkillWeak
	dailyNotes      []domain.DailyNoteHead
	keywords        []domain.MockKeywords
	tracks          []domain.ActiveTrack
	goals           []domain.UserGoal
	ghostedClubs    []domain.GhostedClubSession
	abandonedRecent int
	external        domain.ExternalActivitySummary
	recentActivity  domain.RecentActivitySummary
	mlProfile       domain.MLProfile
	dayShutdown     domain.DayShutdownSnapshot
}

// loadRequiredFeed kicks off the five must-succeed reads concurrently.
// Fail-fast: first reader error → return with wrapped context.
func (uc *GetDailyBrief) loadRequiredFeed(ctx context.Context, userID uuid.UUID, today time.Time) (requiredFeed, error) {
	since14 := today.Add(-14 * 24 * time.Hour)
	since7 := today.Add(-7 * 24 * time.Hour)

	var (
		out                                                          requiredFeed
		focusErr, skippedErr, completedErr, reflErr, recentErr       error
		wg                                                           sync.WaitGroup
	)
	wg.Add(5)
	go func() {
		defer wg.Done()
		out.focus, focusErr = uc.Focus.LastNDays(ctx, userID, 7)
	}()
	go func() {
		defer wg.Done()
		out.skipped, skippedErr = uc.Plans.SkippedItems(ctx, userID, since14)
	}()
	go func() {
		defer wg.Done()
		out.completed, completedErr = uc.Plans.CompletedItems(ctx, userID, since7)
	}()
	go func() {
		defer wg.Done()
		out.refl, reflErr = uc.Notes.RecentReflections(ctx, userID, 5)
	}()
	go func() {
		defer wg.Done()
		out.recent, recentErr = uc.Notes.RecentNotes(ctx, userID, 8)
	}()
	wg.Wait()
	for _, ex := range []struct {
		label string
		err   error
	}{
		{"focus", focusErr},
		{"skipped", skippedErr},
		{"completed", completedErr},
		{"reflections", reflErr},
		{"recent notes", recentErr},
	} {
		if ex.err != nil {
			return requiredFeed{}, fmt.Errorf("intelligence.GetDailyBrief.Do: %s: %w", ex.label, ex.err)
		}
	}
	return out, nil
}

// loadOptionalFeed kicks off all nil-safe cross-product readers in parallel.
// Failures are logged through warnReader; zero values flow downstream.
func (uc *GetDailyBrief) loadOptionalFeed(ctx context.Context, userID uuid.UUID) optionalFeed {
	var (
		out optionalFeed
		wg  sync.WaitGroup
	)
	if uc.Mocks != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if v, err := uc.Mocks.LastNFinished(ctx, userID, 5); err == nil {
				out.mocks = v
			} else {
				warnReader(uc.Log, "mocks", err)
			}
			// Abandoned-mock counter (consistency-break сигнал). 14d window
			// matches «recent» horizon other readers используют.
			if v, err := uc.Mocks.RecentAbandonedCount(ctx, userID, 14); err == nil {
				out.abandonedRecent = v
			} else {
				warnReader(uc.Log, "mocks_abandoned", err)
			}
		}()
	}
	if uc.Queue != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if v, err := uc.Queue.TodaySnapshot(ctx, userID); err == nil {
				out.queue = v
			} else {
				warnReader(uc.Log, "queue", err)
			}
		}()
	}
	if uc.Skills != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if v, err := uc.Skills.WeakestN(ctx, userID, 5); err == nil {
				out.weakSkills = v
			} else {
				warnReader(uc.Log, "skills", err)
			}
		}()
	}
	if uc.DailyNotes != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if v, err := uc.DailyNotes.RecentDailyNotes(ctx, userID, 3); err == nil {
				out.dailyNotes = v
			} else {
				warnReader(uc.Log, "daily_notes", err)
			}
		}()
	}
	if uc.MockMessages != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if v, err := uc.MockMessages.TopKeywords(ctx, userID, 14, 12); err == nil {
				out.keywords = v
			} else {
				warnReader(uc.Log, "mock_messages", err)
			}
		}()
	}
	if uc.Tracks != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if v, err := uc.Tracks.ActiveTracks(ctx, userID); err == nil {
				out.tracks = v
			} else {
				warnReader(uc.Log, "tracks", err)
			}
		}()
	}
	if uc.Goals != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if v, err := uc.Goals.ActiveGoals(ctx, userID); err == nil {
				out.goals = v
			} else {
				warnReader(uc.Log, "goals", err)
			}
		}()
	}
	if uc.Clubs != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if v, err := uc.Clubs.GhostedSessions(ctx, userID, 7); err == nil {
				out.ghostedClubs = v
			} else {
				warnReader(uc.Log, "clubs", err)
			}
		}()
	}
	if uc.External != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if v, err := uc.External.SummaryWindow(ctx, userID, 7); err == nil {
				out.external = v
			} else {
				warnReader(uc.Log, "external_activity", err)
			}
		}()
	}
	if uc.RecentActivity != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if v, err := uc.RecentActivity.Last24h(ctx, userID); err == nil {
				out.recentActivity = v
			} else {
				warnReader(uc.Log, "recent_activity", err)
			}
		}()
	}
	if uc.MLProfile != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Reader is fail-soft contract: IsML=false on any error.
			if v, err := uc.MLProfile.GetMLProfile(ctx, userID); err == nil {
				out.mlProfile = v
			} else {
				warnReader(uc.Log, "ml_profile", err)
			}
		}()
	}
	// DAY SHUTDOWN. Snapshot (HasRecord=false) если юзер не ритуалит /
	// запись старше 2 дней.
	if uc.DayShutdown != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if v, err := uc.DayShutdown.LatestRecent(ctx, userID, 2); err == nil {
				out.dayShutdown = v
			} else {
				warnReader(uc.Log, "day_shutdown", err)
			}
		}()
	}
	wg.Wait()
	return out
}

// loadMemoryRecall fetches past brief / Q&A interactions + Cue memories in
// parallel. Both recall calls are nil-safe (uc.Memory == nil → empty result).
func (uc *GetDailyBrief) loadMemoryRecall(
	ctx context.Context,
	userID uuid.UUID,
	req requiredFeed,
	opt optionalFeed,
) (pastEpisodes, cueMemories []domain.Episode) {
	if uc.Memory == nil {
		return nil, nil
	}
	recallQuery := briefMemoryRecallQuery(
		opt.mocks, opt.weakSkills, opt.keywords, opt.queue, req.skipped, req.recent, opt.dailyNotes,
	)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		if recall, err := uc.Memory.Recall(ctx, RecallParams{
			UserID: userID,
			Query:  recallQuery,
			Kinds: []domain.EpisodeKind{
				domain.EpisodeBriefEmitted,
				domain.EpisodeBriefFollowed,
				domain.EpisodeBriefDismissed,
				domain.EpisodeQAQuery,
				domain.EpisodeQAAnswered,
				// Focus reflections (with grade) surface в "past coach
				// interactions" prompt section. Coach видит «3 days ago
				// user reflected "stuck on joins" grade 2».
				domain.EpisodeFocusReflectionAdded,
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
		defer wg.Done()
		if recall, err := uc.Memory.Recall(ctx, RecallParams{
			UserID:        userID,
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
	wg.Wait()
	return pastEpisodes, cueMemories
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
		domain.EpisodeFocusReflectionAdded,
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
	mocks []domain.MockSessionSummary,
	weakSkills []domain.SkillWeak,
	keywords []domain.MockKeywords,
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

// computePendingFollowups returns brief_followed эпизоды за windowHours,
// чьи titles/kinds должны попасть в next brief как «landed ли X?».
//
// Только actionable closables — review_note (read article) и tiny_task
// (solve drill). schedule = чистый timing, нечего спрашивать; unblock —
// обычно multi-day, не закрывается в одну ночь.
//
// Cap на 3 — coach-prompt and so already busy enough.
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
		// Skip episodes with malformed payloads (free-tier LLM occasionally
		// emits broken JSON). Previously parse errors were discarded into
		// `_` and the downstream kind-check silently dropped them anyway —
		// equivalent behaviour, but explicit `continue` makes the intent
		// readable and decouples us from the kind-check happening to
		// catch empty `p`.
		if err := json.Unmarshal(ep.Payload, &p); err != nil {
			slog.Default().Warn("daily_brief: skip episode with bad payload",
				slog.String("episode_id", ep.ID.String()),
				slog.Any("err", err))
			continue
		}
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
