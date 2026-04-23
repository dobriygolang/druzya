package app

import (
	"context"
	"fmt"
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
type GetReport struct{ Repo domain.ProfileRepo }

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
	return view, nil
}
