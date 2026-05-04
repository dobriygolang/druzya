package app

import (
	"context"
	"testing"
	"time"

	"druz9/learning_state/domain"

	"github.com/google/uuid"
)

type fakeRepo struct {
	store map[uuid.UUID]domain.State
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{store: make(map[uuid.UUID]domain.State)}
}

func (r *fakeRepo) Get(_ context.Context, id uuid.UUID) (domain.State, error) {
	s, ok := r.store[id]
	if !ok {
		return domain.State{}, domain.ErrNotFound
	}
	return s, nil
}

func (r *fakeRepo) Upsert(_ context.Context, s domain.State) error {
	r.store[s.UserID] = s
	return nil
}

func fixedClock(t time.Time) Clock { return func() time.Time { return t } }

func TestGetState_LazyCreatesDefault(t *testing.T) {
	repo := newFakeRepo()
	now := time.Date(2026, 5, 4, 10, 0, 0, 0, time.UTC)
	uc := GetState{Repo: repo, Clock: fixedClock(now)}

	uid := uuid.New()
	s, err := uc.Execute(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	if s.Mode != domain.ModeExplore || !s.ExploreStartedAt.Equal(now) {
		t.Fatalf("expected default explore, got %+v", s)
	}
	if _, ok := repo.store[uid]; !ok {
		t.Fatal("lazy-create did not persist")
	}
}

func TestSetMode_CommitPersists(t *testing.T) {
	repo := newFakeRepo()
	now := time.Now()
	uid := uuid.New()
	tid := uuid.New()

	uc := SetMode{Repo: repo, Clock: fixedClock(now)}
	out, err := uc.Execute(context.Background(), SetModeInput{
		UserID: uid, Mode: domain.ModeCommit, TrackID: &tid,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Mode != domain.ModeCommit || out.CommittedTrackID == nil || *out.CommittedTrackID != tid {
		t.Fatalf("commit not applied: %+v", out)
	}
	if out.CommittedAt == nil {
		t.Fatal("committed_at must be set")
	}
}

func TestSetFork_NilClears(t *testing.T) {
	repo := newFakeRepo()
	now := time.Now()
	uid := uuid.New()
	branch := domain.ForkDE
	repo.store[uid] = domain.State{
		UserID:           uid,
		Mode:             domain.ModeExplore,
		ForkBranch:       &branch,
		ExploreStartedAt: now.Add(-time.Hour),
		CreatedAt:        now.Add(-time.Hour),
		UpdatedAt:        now.Add(-time.Hour),
	}

	uc := SetFork{Repo: repo, Clock: fixedClock(now)}
	out, err := uc.Execute(context.Background(), SetForkInput{UserID: uid, Branch: nil})
	if err != nil {
		t.Fatal(err)
	}
	if out.ForkBranch != nil {
		t.Fatalf("fork must be cleared, got %v", *out.ForkBranch)
	}
}
