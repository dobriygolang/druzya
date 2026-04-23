package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/profile/domain"

	"github.com/google/uuid"
)

// ReportView is the weekly report shape passed to ports.
type ReportView struct {
	WeekStart       time.Time
	WeekEnd         time.Time
	Metrics         domain.Activity
	Heatmap         []int
	Strengths       []string
	Weaknesses      []ReportWeakness
	StressAnalysis  string
	Recommendations []Recommendation

	// Поля ниже — расширения для /report (WeeklyReportPage). Заполняются
	// агрегациями из дополнительных запросов; на старых клиентах безопасно
	// игнорируются (proto3 default values).
	ActionsCount   int
	StreakDays     int
	BestStreak     int
	PrevXPEarned   int
	StrongSections []domain.SectionBreakdown
	WeakSections   []domain.SectionBreakdown
	WeeklyXP       []domain.WeekComparison

	// AIInsight — Phase B: 2-paragraph Russian narrative produced by the
	// OpenRouter insight client. Empty string when the LLM is disabled
	// (OPENROUTER_API_KEY missing) or upstream call failed; the frontend
	// hides the section in that case (anti-fallback policy).
	AIInsight string
}

// InsightPayload mirrors infra.InsightPayload but lives in the app layer to
// avoid an app→infra import. The wirer adapts the two structs.
type InsightPayload struct {
	WeekISO           string
	EloDelta          int
	WinRateBySection  map[string]int
	HoursStudied      float64
	Streak            int
	WeakestSection    string
	AchievementsCount int
}

// InsightGenerator is the narrow port the GetReport use case depends on.
// Concrete impl in infra/openrouter_insight.go. Pass nil to disable insight
// generation entirely (the use case skips the call and leaves AIInsight="").
type InsightGenerator interface {
	Generate(ctx context.Context, userID uuid.UUID, p InsightPayload) (string, error)
}

// ReportWeakness is a node-scoped weak spot.
type ReportWeakness struct {
	AtlasNodeKey string
	Reason       string
}

// Recommendation mirrors openapi's Recommendation schema.
type Recommendation struct {
	Title       string
	Description string
	ActionKind  string
	Params      map[string]any
}

// GetReport is a STUB-heavy MVP implementation. It composes basic activity
// counts from real tables but leaves the AI-narrated fields as placeholders.
//
// STUB: LLM narrative generation — stress_analysis, strengths, weaknesses and
//
//	recommendations should come from an async job that consumes
//	arena_matches + mock_sessions + native_sessions over the last 7 days,
//	batches them, and asks the LLM to summarise. Wire once ai_mock/ai_native
//	services are ready.
type GetReport struct {
	Repo domain.ProfileRepo

	// Insight is optional (Phase B). When nil, AIInsight is left empty and
	// the frontend hides the section. When non-nil, generation errors are
	// swallowed (logged) — insight is best-effort and must not block the
	// report.
	Insight InsightGenerator
	Log     *slog.Logger
}

// Do assembles the MVP report shape.
//
// Aggregates loaded:
//   - 7-day activity counters (matches won, XP, time)
//   - Per-section win/loss/XP breakdown (strong / weak sections)
//   - Last 4 weeks XP comparison (for the "Последние 4 недели" widget)
//   - Current/best streak (active days)
//
// Repo errors на necheckpath-методах (ListMatchAggregatesSince/ListWeeklyXPSince/
// GetStreaks) НЕ роняют запрос — без этих агрегатов отчёт деградирует к
// «нет данных», но базовые метрики продолжают работать.
func (uc *GetReport) Do(ctx context.Context, userID uuid.UUID, now time.Time) (ReportView, error) {
	end := now.UTC().Truncate(24 * time.Hour)
	start := end.Add(-7 * 24 * time.Hour)
	metrics, err := uc.Repo.CountRecentActivity(ctx, userID, start)
	if err != nil {
		return ReportView{}, fmt.Errorf("profile.GetReport: activity: %w", err)
	}

	view := ReportView{
		WeekStart:      start,
		WeekEnd:        end,
		Metrics:        metrics,
		Heatmap:        []int{0, 0, 0, 0, 0, 0, 0},
		Strengths:      []string{},
		Weaknesses:     []ReportWeakness{},
		StressAnalysis: "",
		Recommendations: []Recommendation{{
			Title:       "Open the Skill Atlas",
			Description: "Take a look at your weakest nodes and schedule a practice slot.",
			ActionKind:  "open_atlas",
		}},
	}

	if aggs, aerr := uc.Repo.ListMatchAggregatesSince(ctx, userID, start); aerr == nil {
		strong, weak := domain.AggregateBySection(aggs)
		view.StrongSections = strong
		view.WeakSections = weak
		view.ActionsCount = len(aggs)
	}
	if xp, xerr := uc.Repo.ListWeeklyXPSince(ctx, userID, end, 4); xerr == nil {
		view.WeeklyXP = domain.BuildWeeklyComparison(xp)
		if len(xp) >= 2 {
			view.PrevXPEarned = xp[1]
		}
	}
	if cur, best, serr := uc.Repo.GetStreaks(ctx, userID); serr == nil {
		view.StreakDays = cur
		view.BestStreak = best
	}

	// ── Phase B: AI insight ────────────────────────────────────────────────
	//
	// Build the payload from already-aggregated fields (no extra SQL) and
	// ask the LLM. Errors are logged + swallowed: insight is best-effort,
	// the rest of the report is fully functional without it.
	if uc.Insight != nil {
		payload := buildInsightPayload(view, end)
		insight, ierr := uc.Insight.Generate(ctx, userID, payload)
		if ierr != nil {
			if uc.Log != nil {
				uc.Log.Warn("profile.GetReport: insight generation failed",
					slog.Any("user_id", userID),
					slog.String("week_iso", payload.WeekISO),
					slog.Any("err", ierr))
			}
		} else {
			view.AIInsight = insight
		}
	}
	return view, nil
}

// buildInsightPayload distils the aggregated ReportView into the compact
// InsightPayload the LLM consumes. weekEnd is the (UTC, midnight) end of the
// 7-day window — formatted as ISO week string for the cache key.
func buildInsightPayload(v ReportView, weekEnd time.Time) InsightPayload {
	winRates := make(map[string]int, len(v.StrongSections)+len(v.WeakSections))
	for _, s := range v.StrongSections {
		winRates[s.Section.String()] = s.WinRatePct
	}
	for _, s := range v.WeakSections {
		winRates[s.Section.String()] = s.WinRatePct
	}
	weakest := ""
	if len(v.WeakSections) > 0 {
		weakest = v.WeakSections[0].Section.String()
	}
	year, week := weekEnd.ISOWeek()
	return InsightPayload{
		WeekISO:          fmt.Sprintf("%04d-W%02d", year, week),
		EloDelta:         v.Metrics.RatingChange,
		WinRateBySection: winRates,
		HoursStudied:     float64(v.Metrics.TimeMinutes) / 60.0,
		Streak:           v.StreakDays,
		WeakestSection:   weakest,
		// AchievementsCount stays 0 in MVP — ListAchievementsSince is a
		// separate repo method not currently wired into the use case;
		// extending it is Phase B+1 work and would inflate this PR.
		AchievementsCount: 0,
	}
}
