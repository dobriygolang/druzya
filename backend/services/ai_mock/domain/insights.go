package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// StagePerformance — pass-rate per stage_kind over a trailing window.
type StagePerformance struct {
	StageKind string
	Total     int
	Passed    int
}

// RecurringPattern — top-N missing_points label + occurrence count.
type RecurringPattern struct {
	Point string
	Count int
}

// ScoreTrajectoryPoint — one finished pipeline as a sparkline datapoint.
type ScoreTrajectoryPoint struct {
	PipelineID uuid.UUID
	FinishedAt time.Time
	Score      float64
	Verdict    string
}

// PipelineHeadline — total finished sessions + pass-rate over the window.
type PipelineHeadline struct {
	TotalSessions int
	PassRatePct   int
}

// InsightsRepo aggregates the data for the /insights overview page. Each
// method is independently fail-soft: partial failures bubble up so the caller
// can decide whether to surface a degraded snapshot or a 5xx.
type InsightsRepo interface {
	StagePerformance(ctx context.Context, userID uuid.UUID, windowDays int) ([]StagePerformance, error)
	RecurringPatterns(ctx context.Context, userID uuid.UUID, windowDays, topN int) ([]RecurringPattern, error)
	ScoreTrajectory(ctx context.Context, userID uuid.UUID, limit int) ([]ScoreTrajectoryPoint, error)
	PipelineHeadline(ctx context.Context, userID uuid.UUID, windowDays int) (PipelineHeadline, error)
}
