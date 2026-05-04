package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/profile/domain"
	"druz9/profile/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// expectActivity is the bare-minimum fixture every report test needs — the
// report use case fails fast if CountRecentActivity returns an error.
func expectActivity(repo *mocks.MockProfileRepo, uid uuid.UUID) {
	repo.EXPECT().CountRecentActivity(gomock.Any(), uid, gomock.Any()).Return(domain.Activity{
		MatchesWon: 12, XPEarned: 2480, TimeMinutes: 90, TasksSolved: 23,
	}, nil)
}

func TestGetReport_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	expectActivity(repo, uid)
	repo.EXPECT().GetStreaks(gomock.Any(), uid).Return(7, 47, nil)

	uc := &GetReport{Repo: repo}
	v, err := uc.Do(context.Background(), uid, time.Now())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if v.Metrics.MatchesWon != 12 {
		t.Fatalf("metrics not propagated, %+v", v.Metrics)
	}
	if v.StreakDays != 7 || v.BestStreak != 47 {
		t.Fatalf("streak mismatch cur=%d best=%d", v.StreakDays, v.BestStreak)
	}
}

func TestGetReport_ActivityErrorPropagated(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().CountRecentActivity(gomock.Any(), uid, gomock.Any()).Return(domain.Activity{}, errors.New("pg blew up"))

	uc := &GetReport{Repo: repo}
	if _, err := uc.Do(context.Background(), uid, time.Now()); err == nil {
		t.Fatal("expected propagation of activity error")
	}
}

func TestGetReport_WindowIs7Days(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	now := time.Date(2026, time.April, 22, 12, 0, 0, 0, time.UTC)
	wantStart := now.UTC().Truncate(24 * time.Hour).Add(-7 * 24 * time.Hour)
	repo.EXPECT().CountRecentActivity(gomock.Any(), uid, gomock.AssignableToTypeOf(time.Time{})).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, since time.Time) (domain.Activity, error) {
			if !since.Equal(wantStart) {
				t.Fatalf("window start mismatch: got %v want %v", since, wantStart)
			}
			return domain.Activity{}, nil
		})
	repo.EXPECT().GetStreaks(gomock.Any(), uid).Return(0, 0, nil)

	uc := &GetReport{Repo: repo}
	if _, err := uc.Do(context.Background(), uid, now); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestGetReport_RecommendationFallback(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	expectActivity(repo, uid)
	repo.EXPECT().GetStreaks(gomock.Any(), uid).Return(0, 0, nil)

	uc := &GetReport{Repo: repo}
	v, _ := uc.Do(context.Background(), uid, time.Now())
	if len(v.Recommendations) == 0 {
		t.Fatal("expected at least one fallback recommendation")
	}
	if v.Recommendations[0].ActionKind != "open_atlas" {
		t.Fatalf("recommendation kind=%s", v.Recommendations[0].ActionKind)
	}
}

func TestGetReport_HeatmapDefaultsToZeros(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	expectActivity(repo, uid)
	repo.EXPECT().GetStreaks(gomock.Any(), uid).Return(0, 0, nil)

	uc := &GetReport{Repo: repo}
	v, _ := uc.Do(context.Background(), uid, time.Now())
	if len(v.Heatmap) != 7 {
		t.Fatalf("expected 7-cell heatmap, got %d", len(v.Heatmap))
	}
}

// stubInsight implements InsightGenerator. lastPayload captures the last
// payload it received so we can assert the use case built it from the
// already-aggregated ReportView fields (no extra SQL on the LLM path).
type stubInsight struct {
	out         string
	err         error
	called      int
	lastPayload InsightPayload
	lastUID     uuid.UUID
}

func (s *stubInsight) Generate(_ context.Context, uid uuid.UUID, p InsightPayload) (string, error) {
	s.called++
	s.lastPayload = p
	s.lastUID = uid
	return s.out, s.err
}

func TestGetReport_AIInsight_PopulatedWhenClientConfigured(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().CountRecentActivity(gomock.Any(), uid, gomock.Any()).Return(domain.Activity{
		MatchesWon: 5, XPEarned: 1200, TimeMinutes: 240, RatingChange: 35,
	}, nil)
	repo.EXPECT().GetStreaks(gomock.Any(), uid).Return(3, 9, nil)
	repo.EXPECT().GetSettings(gomock.Any(), uid).Return(domain.Settings{}, nil)

	stub := &stubInsight{out: "AI-generated coaching narrative."}
	uc := &GetReport{Repo: repo, Insight: stub}
	v, err := uc.Do(context.Background(), uid, time.Now())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if v.AIInsight != "AI-generated coaching narrative." {
		t.Fatalf("AIInsight not populated: %q", v.AIInsight)
	}
	if stub.called != 1 {
		t.Fatalf("expected 1 insight call, got %d", stub.called)
	}
	if stub.lastUID != uid {
		t.Fatalf("uid mismatch")
	}
	if stub.lastPayload.WeekISO == "" {
		t.Fatalf("WeekISO not built")
	}
	if stub.lastPayload.EloDelta != 35 {
		t.Fatalf("EloDelta mismatch: %d", stub.lastPayload.EloDelta)
	}
	if stub.lastPayload.HoursStudied != 4.0 {
		t.Fatalf("HoursStudied mismatch: %v", stub.lastPayload.HoursStudied)
	}
	if stub.lastPayload.Streak != 3 {
		t.Fatalf("Streak mismatch: %d", stub.lastPayload.Streak)
	}
}

func TestGetReport_AIInsight_ErrorIsSwallowed(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	expectActivity(repo, uid)
	repo.EXPECT().GetStreaks(gomock.Any(), uid).Return(0, 0, nil)
	repo.EXPECT().GetSettings(gomock.Any(), uid).Return(domain.Settings{}, nil)

	stub := &stubInsight{err: errors.New("openrouter offline")}
	uc := &GetReport{Repo: repo, Insight: stub}
	v, err := uc.Do(context.Background(), uid, time.Now())
	if err != nil {
		t.Fatalf("insight failure must NOT bubble: %v", err)
	}
	if v.AIInsight != "" {
		t.Fatalf("expected empty AIInsight on error, got %q", v.AIInsight)
	}
}

func TestGetReport_FeaturedMetric_StreakWhenStreakHigh(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	expectActivity(repo, uid)
	repo.EXPECT().GetStreaks(gomock.Any(), uid).Return(7, 12, nil)

	uc := &GetReport{Repo: repo}
	v, err := uc.Do(context.Background(), uid, time.Now())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if v.FeaturedMetric != "streak" {
		t.Fatalf("expected featured=streak, got %q", v.FeaturedMetric)
	}
}

func TestGetReport_FeaturedMetric_DefaultXP(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	expectActivity(repo, uid)
	repo.EXPECT().GetStreaks(gomock.Any(), uid).Return(3, 12, nil)

	uc := &GetReport{Repo: repo}
	v, err := uc.Do(context.Background(), uid, time.Now())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if v.FeaturedMetric != "xp" {
		t.Fatalf("expected featured=xp, got %q", v.FeaturedMetric)
	}
}

func TestGetReport_StreakErrorTolerated(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	expectActivity(repo, uid)
	repo.EXPECT().GetStreaks(gomock.Any(), uid).Return(0, 0, errors.New("streak table missing"))

	uc := &GetReport{Repo: repo}
	v, err := uc.Do(context.Background(), uid, time.Now())
	if err != nil {
		t.Fatalf("streak failure must not bubble: %v", err)
	}
	if v.StreakDays != 0 {
		t.Fatalf("expected zero streak on error, got %d", v.StreakDays)
	}
}
