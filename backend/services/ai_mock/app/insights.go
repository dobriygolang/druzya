// insights.go — use-case for the /mock/insights/overview page.
// Pulls the four aggregations (stage performance, recurring patterns,
// score trajectory, headline counters) in parallel-friendly fashion;
// individual sub-query failures are surfaced via OnPartialErr so the
// caller can render a degraded snapshot instead of returning a 5xx.
package app

import (
	"context"

	"druz9/ai_mock/domain"

	"github.com/google/uuid"
)

// InsightsOverviewInput is the request shape.
type InsightsOverviewInput struct {
	UserID     uuid.UUID
	WindowDays int
	ScoreLimit int
	TopMissing int
}

// InsightsOverviewOutput is the aggregated result.
type InsightsOverviewOutput struct {
	StagePerformance  []domain.StagePerformance
	RecurringPatterns []domain.RecurringPattern
	ScoreTrajectory   []domain.ScoreTrajectoryPoint
	Headline          domain.PipelineHeadline
	// English HR aggregation (Wave 1 of docs/feature/english.md).
	// Zero-value EnglishHRTrend{} when the user has no English HR
	// sessions in the window — frontend then hides the card.
	EnglishHR domain.EnglishHRTrend
}

// InsightsOverview is the use-case.
type InsightsOverview struct {
	Repo domain.InsightsRepo
	// OnPartialErr (optional) is invoked when a sub-aggregation fails. The
	// op string identifies which one ("stage_performance" |
	// "recurring_patterns" | "score_trajectory" | "headline"). Whatever
	// blocks did succeed are still returned in the output. Mirrors the
	// pre-refactor handler's `fail()` behaviour.
	OnPartialErr func(ctx context.Context, op string, err error)
}

// Run executes the four aggregations and returns the combined result.
func (uc *InsightsOverview) Run(ctx context.Context, in InsightsOverviewInput) (InsightsOverviewOutput, error) {
	out := InsightsOverviewOutput{
		StagePerformance:  []domain.StagePerformance{},
		RecurringPatterns: []domain.RecurringPattern{},
		ScoreTrajectory:   []domain.ScoreTrajectoryPoint{},
	}
	if rows, err := uc.Repo.StagePerformance(ctx, in.UserID, in.WindowDays); err != nil {
		uc.partial(ctx, "stage_performance", err)
	} else {
		out.StagePerformance = rows
	}
	if rows, err := uc.Repo.RecurringPatterns(ctx, in.UserID, in.WindowDays, in.TopMissing); err != nil {
		uc.partial(ctx, "recurring_patterns", err)
	} else {
		out.RecurringPatterns = rows
	}
	if rows, err := uc.Repo.ScoreTrajectory(ctx, in.UserID, in.ScoreLimit); err != nil {
		uc.partial(ctx, "score_trajectory", err)
	} else {
		out.ScoreTrajectory = rows
	}
	if h, err := uc.Repo.PipelineHeadline(ctx, in.UserID, in.WindowDays); err != nil {
		uc.partial(ctx, "headline", err)
	} else {
		out.Headline = h
	}
	if t, err := uc.Repo.EnglishHRTrend(ctx, in.UserID, in.WindowDays, in.ScoreLimit); err != nil {
		uc.partial(ctx, "english_hr_trend", err)
	} else {
		out.EnglishHR = t
	}
	return out, nil
}

func (uc *InsightsOverview) partial(ctx context.Context, op string, err error) {
	if uc.OnPartialErr != nil {
		uc.OnPartialErr(ctx, op, err)
	}
}
