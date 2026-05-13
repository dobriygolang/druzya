//go:generate mockgen -package mocks -destination mocks/insights_mock.go -source insights.go
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

// EnglishHRTrendPoint — one finished English HR mock as a sparkline datapoint.
// Lightweight by design: the right column on /insights only needs the
// score and the timestamp; deep-link goes through the SessionID.
type EnglishHRTrendPoint struct {
	SessionID  uuid.UUID
	FinishedAt time.Time
	Score      int
}

// EnglishHRTrend aggregates English HR mock-rounds
// (section='english_hr') over the trailing window. Empty
// values (TotalSessions = 0) mean "user hasn't done any English mocks
// yet" — the frontend hides the card in that case so the page doesn't
// look broken.
type EnglishHRTrend struct {
	TotalSessions  int
	AvgScore       int                   // 0 when TotalSessions == 0
	LastScore      int                   // 0 when TotalSessions == 0
	LastFinishedAt time.Time             // zero when TotalSessions == 0
	Trajectory     []EnglishHRTrendPoint // ASC by FinishedAt, latest 10
}

// InsightsRepo aggregates the data for the /insights overview page. Each
// method is independently fail-soft: partial failures bubble up so the caller
// can decide whether to surface a degraded snapshot or a 5xx.
type InsightsRepo interface {
	StagePerformance(ctx context.Context, userID uuid.UUID, windowDays int) ([]StagePerformance, error)
	RecurringPatterns(ctx context.Context, userID uuid.UUID, windowDays, topN int) ([]RecurringPattern, error)
	ScoreTrajectory(ctx context.Context, userID uuid.UUID, limit int) ([]ScoreTrajectoryPoint, error)
	PipelineHeadline(ctx context.Context, userID uuid.UUID, windowDays int) (PipelineHeadline, error)
	// EnglishHRTrend — sessions where section='english_hr' and ai_report
	// is non-null. Empty result is valid (returned as zero-value struct).
	EnglishHRTrend(ctx context.Context, userID uuid.UUID, windowDays, trajectoryLimit int) (EnglishHRTrend, error)
}
