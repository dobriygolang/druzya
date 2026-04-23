package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/admin/domain"
)

// fakeDashboardRepo is a hand-rolled implementation of DashboardRepo. We
// avoid mockgen here because the tests are tiny and a mockgen file for
// every new interface would bloat the package.
type fakeDashboardRepo struct {
	calls int
	out   domain.AdminDashboard
	err   error
}

func (f *fakeDashboardRepo) Snapshot(_ context.Context, now time.Time) (domain.AdminDashboard, error) {
	f.calls++
	if f.err != nil {
		return domain.AdminDashboard{}, f.err
	}
	out := f.out
	out.GeneratedAt = now
	return out, nil
}

func TestGetDashboard_Do_NoCacheHitsRepo(t *testing.T) {
	t.Parallel()
	repo := &fakeDashboardRepo{out: domain.AdminDashboard{UsersTotal: 42}}
	uc := &GetDashboard{Repo: repo, Now: func() time.Time { return time.Unix(1700000000, 0) }}

	got, err := uc.Do(context.Background())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if got.UsersTotal != 42 {
		t.Fatalf("UsersTotal: got %d, want 42", got.UsersTotal)
	}
	if repo.calls != 1 {
		t.Fatalf("repo should be hit once when cache is nil, got %d", repo.calls)
	}
	if got.GeneratedAt.IsZero() {
		t.Fatal("GeneratedAt must be stamped")
	}
}

func TestGetDashboard_Do_RepoErrorPropagates(t *testing.T) {
	t.Parallel()
	want := errors.New("boom")
	uc := &GetDashboard{Repo: &fakeDashboardRepo{err: want}}
	if _, err := uc.Do(context.Background()); !errors.Is(err, want) {
		t.Fatalf("error must wrap repo failure, got %v", err)
	}
}
