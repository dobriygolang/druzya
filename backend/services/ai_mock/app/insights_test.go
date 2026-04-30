package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/ai_mock/domain"

	"github.com/google/uuid"
)

// fakeInsightsRepo is a hand-rolled fake (the project doesn't ship a
// generated mock for InsightsRepo — see domain/repo.go's go:generate
// directive, which only covers repo.go, not insights.go). Keeping the
// fake in this file because it's the only consumer.
type fakeInsightsRepo struct {
	stage    func(ctx context.Context, userID uuid.UUID, windowDays int) ([]domain.StagePerformance, error)
	patterns func(ctx context.Context, userID uuid.UUID, windowDays, topN int) ([]domain.RecurringPattern, error)
	traj     func(ctx context.Context, userID uuid.UUID, limit int) ([]domain.ScoreTrajectoryPoint, error)
	headline func(ctx context.Context, userID uuid.UUID, windowDays int) (domain.PipelineHeadline, error)
	englishH func(ctx context.Context, userID uuid.UUID, windowDays, trajectoryLimit int) (domain.EnglishHRTrend, error)
}

func (f fakeInsightsRepo) StagePerformance(ctx context.Context, u uuid.UUID, w int) ([]domain.StagePerformance, error) {
	if f.stage != nil {
		return f.stage(ctx, u, w)
	}
	return nil, nil
}
func (f fakeInsightsRepo) RecurringPatterns(ctx context.Context, u uuid.UUID, w, n int) ([]domain.RecurringPattern, error) {
	if f.patterns != nil {
		return f.patterns(ctx, u, w, n)
	}
	return nil, nil
}
func (f fakeInsightsRepo) ScoreTrajectory(ctx context.Context, u uuid.UUID, l int) ([]domain.ScoreTrajectoryPoint, error) {
	if f.traj != nil {
		return f.traj(ctx, u, l)
	}
	return nil, nil
}
func (f fakeInsightsRepo) PipelineHeadline(ctx context.Context, u uuid.UUID, w int) (domain.PipelineHeadline, error) {
	if f.headline != nil {
		return f.headline(ctx, u, w)
	}
	return domain.PipelineHeadline{}, nil
}
func (f fakeInsightsRepo) EnglishHRTrend(ctx context.Context, u uuid.UUID, w, l int) (domain.EnglishHRTrend, error) {
	if f.englishH != nil {
		return f.englishH(ctx, u, w, l)
	}
	return domain.EnglishHRTrend{}, nil
}

func TestInsightsOverview_RunPopulatesEnglishHR(t *testing.T) {
	t.Parallel()
	want := domain.EnglishHRTrend{
		TotalSessions:  3,
		AvgScore:       72,
		LastScore:      80,
		LastFinishedAt: time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC),
		Trajectory: []domain.EnglishHRTrendPoint{
			{SessionID: uuid.New(), Score: 65, FinishedAt: time.Date(2026, 4, 25, 0, 0, 0, 0, time.UTC)},
			{SessionID: uuid.New(), Score: 71, FinishedAt: time.Date(2026, 4, 28, 0, 0, 0, 0, time.UTC)},
			{SessionID: uuid.New(), Score: 80, FinishedAt: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)},
		},
	}
	repo := fakeInsightsRepo{
		englishH: func(_ context.Context, _ uuid.UUID, w, l int) (domain.EnglishHRTrend, error) {
			if w != 30 || l != 10 {
				t.Errorf("EnglishHRTrend called with windowDays=%d, limit=%d; want 30/10", w, l)
			}
			return want, nil
		},
	}
	uc := &InsightsOverview{Repo: repo}
	out, err := uc.Run(context.Background(), InsightsOverviewInput{
		UserID: uuid.New(), WindowDays: 30, ScoreLimit: 10, TopMissing: 8,
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.EnglishHR.TotalSessions != want.TotalSessions {
		t.Errorf("EnglishHR.TotalSessions = %d, want %d", out.EnglishHR.TotalSessions, want.TotalSessions)
	}
	if out.EnglishHR.AvgScore != want.AvgScore {
		t.Errorf("EnglishHR.AvgScore = %d, want %d", out.EnglishHR.AvgScore, want.AvgScore)
	}
	if len(out.EnglishHR.Trajectory) != len(want.Trajectory) {
		t.Errorf("trajectory len = %d, want %d", len(out.EnglishHR.Trajectory), len(want.Trajectory))
	}
}

func TestInsightsOverview_EnglishHRError_PartialReportedNotFatal(t *testing.T) {
	t.Parallel()
	var partialOps []string
	boom := errors.New("pgx: pool closed")
	repo := fakeInsightsRepo{
		englishH: func(_ context.Context, _ uuid.UUID, _, _ int) (domain.EnglishHRTrend, error) {
			return domain.EnglishHRTrend{}, boom
		},
		// Other aggregations succeed with empty results.
	}
	uc := &InsightsOverview{
		Repo: repo,
		OnPartialErr: func(_ context.Context, op string, _ error) {
			partialOps = append(partialOps, op)
		},
	}
	out, err := uc.Run(context.Background(), InsightsOverviewInput{
		UserID: uuid.New(), WindowDays: 30, ScoreLimit: 10, TopMissing: 8,
	})
	if err != nil {
		t.Fatalf("Run must NOT return a fatal error on partial fail; got %v", err)
	}
	// Other blocks still populated (zero-value, but populated).
	if out.EnglishHR.TotalSessions != 0 {
		t.Errorf("on EnglishHR error, EnglishHR field must remain zero-value; got %+v", out.EnglishHR)
	}
	// Partial reporter must have recorded the failure.
	found := false
	for _, op := range partialOps {
		if op == "english_hr_trend" {
			found = true
		}
	}
	if !found {
		t.Errorf("partial-error callback didn't fire for english_hr_trend; got ops=%v", partialOps)
	}
}

func TestInsightsOverview_NoEnglishHRSessions_LeavesZeroValue(t *testing.T) {
	t.Parallel()
	repo := fakeInsightsRepo{
		englishH: func(_ context.Context, _ uuid.UUID, _, _ int) (domain.EnglishHRTrend, error) {
			return domain.EnglishHRTrend{Trajectory: []domain.EnglishHRTrendPoint{}}, nil
		},
	}
	uc := &InsightsOverview{Repo: repo}
	out, err := uc.Run(context.Background(), InsightsOverviewInput{
		UserID: uuid.New(), WindowDays: 30, ScoreLimit: 10, TopMissing: 8,
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.EnglishHR.TotalSessions != 0 {
		t.Errorf("expected zero-value EnglishHR for empty user; got %+v", out.EnglishHR)
	}
	if !out.EnglishHR.LastFinishedAt.IsZero() {
		t.Errorf("LastFinishedAt must be zero for empty result; got %v", out.EnglishHR.LastFinishedAt)
	}
}
