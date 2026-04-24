package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// fakeClock — детерминированный источник для тестов.
type fakeClock struct{ now time.Time }

func (f fakeClock) Now() time.Time { return f.now }

// fakeRepo — in-memory реализация domain.Repo для unit-тестов.
type fakeRepo struct {
	sub     *domain.Subscription
	err     error
	listRet []domain.Subscription
}

func (r *fakeRepo) Get(_ context.Context, _ uuid.UUID) (domain.Subscription, error) {
	if r.err != nil {
		return domain.Subscription{}, r.err
	}
	if r.sub == nil {
		return domain.Subscription{}, domain.ErrNotFound
	}
	return *r.sub, nil
}

func (r *fakeRepo) Upsert(_ context.Context, sub domain.Subscription) error {
	r.sub = &sub
	return nil
}

func (r *fakeRepo) ListByPlan(_ context.Context, _ domain.Tier, _, _ int) ([]domain.Subscription, error) {
	return r.listRet, nil
}

func (r *fakeRepo) MarkExpired(_ context.Context, _ time.Time) (int64, error) {
	return 0, nil
}

func TestGetTier_NoRow_ReturnsFree(t *testing.T) {
	uc := NewGetTier(&fakeRepo{}, fakeClock{now: time.Now()})
	tier, err := uc.Do(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if tier != domain.TierFree {
		t.Fatalf("want TierFree, got %s", tier)
	}
}

func TestGetTier_RepoErr_Propagates(t *testing.T) {
	repoErr := errors.New("pg down")
	uc := NewGetTier(&fakeRepo{err: repoErr}, fakeClock{now: time.Now()})
	_, err := uc.Do(context.Background(), uuid.New())
	if err == nil || !errors.Is(err, repoErr) {
		t.Fatalf("want pg down wrapped, got %v", err)
	}
}

func TestGetTier_ExpiredPastGrace_ReturnsFree(t *testing.T) {
	now := time.Now().UTC()
	past := now.Add(-48 * time.Hour)
	sub := domain.Subscription{
		Tier: domain.TierSeeker, Status: domain.StatusActive,
		CurrentPeriodEnd: &past, GraceUntil: &past,
	}
	uc := NewGetTier(&fakeRepo{sub: &sub}, fakeClock{now: now})
	tier, _ := uc.Do(context.Background(), uuid.New())
	if tier != domain.TierFree {
		t.Fatalf("expired must degrade, got %s", tier)
	}
}

func TestGetTier_ActiveSeeker_Returns(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(24 * time.Hour)
	sub := domain.Subscription{
		Tier: domain.TierSeeker, Status: domain.StatusActive, CurrentPeriodEnd: &future,
	}
	uc := NewGetTier(&fakeRepo{sub: &sub}, fakeClock{now: now})
	tier, _ := uc.Do(context.Background(), uuid.New())
	if tier != domain.TierSeeker {
		t.Fatalf("want seeker, got %s", tier)
	}
}

func TestGetTier_DoFull_NoRow_ReturnsSynthetic(t *testing.T) {
	uc := NewGetTier(&fakeRepo{}, fakeClock{now: time.Now()})
	sub, err := uc.DoFull(context.Background(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if sub.Tier != domain.TierFree {
		t.Fatalf("synthetic must be free, got %s", sub.Tier)
	}
	if sub.Status != domain.StatusActive {
		t.Fatalf("synthetic must be active, got %s", sub.Status)
	}
}
