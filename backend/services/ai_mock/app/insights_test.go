package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/ai_mock/domain"
	"druz9/ai_mock/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestInsightsOverview_RunPopulatesEnglishHR(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
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
	repo := mocks.NewMockInsightsRepo(ctrl)
	repo.EXPECT().StagePerformance(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	repo.EXPECT().RecurringPatterns(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	repo.EXPECT().ScoreTrajectory(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	repo.EXPECT().PipelineHeadline(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.PipelineHeadline{}, nil).AnyTimes()
	repo.EXPECT().EnglishHRTrend(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, w, l int) (domain.EnglishHRTrend, error) {
			if w != 30 || l != 10 {
				t.Errorf("EnglishHRTrend called with windowDays=%d, limit=%d; want 30/10", w, l)
			}
			return want, nil
		},
	)
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
	ctrl := gomock.NewController(t)
	var partialOps []string
	boom := errors.New("pgx: pool closed")
	repo := mocks.NewMockInsightsRepo(ctrl)
	repo.EXPECT().StagePerformance(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	repo.EXPECT().RecurringPatterns(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	repo.EXPECT().ScoreTrajectory(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	repo.EXPECT().PipelineHeadline(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.PipelineHeadline{}, nil).AnyTimes()
	repo.EXPECT().EnglishHRTrend(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.EnglishHRTrend{}, boom)
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
	if out.EnglishHR.TotalSessions != 0 {
		t.Errorf("on EnglishHR error, EnglishHR field must remain zero-value; got %+v", out.EnglishHR)
	}
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
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockInsightsRepo(ctrl)
	repo.EXPECT().StagePerformance(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	repo.EXPECT().RecurringPatterns(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	repo.EXPECT().ScoreTrajectory(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	repo.EXPECT().PipelineHeadline(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.PipelineHeadline{}, nil).AnyTimes()
	repo.EXPECT().EnglishHRTrend(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.EnglishHRTrend{Trajectory: []domain.EnglishHRTrendPoint{}}, nil)
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
