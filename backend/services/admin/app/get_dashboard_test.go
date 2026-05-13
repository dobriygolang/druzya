package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/admin/domain"
	"druz9/admin/domain/mocks"

	"go.uber.org/mock/gomock"
)

func TestGetDashboard_Do_NoCacheHitsRepo(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockDashboardRepo(ctrl)
	repo.EXPECT().Snapshot(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, now time.Time) (domain.AdminDashboard, error) {
			return domain.AdminDashboard{UsersTotal: 42, GeneratedAt: now}, nil
		},
	).Times(1)
	uc := &GetDashboard{Repo: repo, Now: func() time.Time { return time.Unix(1700000000, 0) }}

	got, err := uc.Do(context.Background())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if got.UsersTotal != 42 {
		t.Fatalf("UsersTotal: got %d, want 42", got.UsersTotal)
	}
	if got.GeneratedAt.IsZero() {
		t.Fatal("GeneratedAt must be stamped")
	}
}

func TestGetDashboard_Do_RepoErrorPropagates(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	want := errors.New("boom")
	repo := mocks.NewMockDashboardRepo(ctrl)
	repo.EXPECT().Snapshot(gomock.Any(), gomock.Any()).Return(domain.AdminDashboard{}, want)
	uc := &GetDashboard{Repo: repo}
	if _, err := uc.Do(context.Background()); !errors.Is(err, want) {
		t.Fatalf("error must wrap repo failure, got %v", err)
	}
}
