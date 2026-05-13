package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"druz9/subscription/domain"
	submocks "druz9/subscription/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// fakeClock — детерминированный источник для тестов (pure value, не mock).
// Это удобнее inline-инстанциация чем gomock, потому что Clock — это
// 1-method interface без stateful behavior.
type fakeClock struct{ now time.Time }

func (f fakeClock) Now() time.Time { return f.now }

// discardLogger — silent logger для unit-тестов (общий для всего пакета).
func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// subRepoStore — закрытая state-машина для domain.Repo: holds last upsert
// + simulated read-time error. Подключается через wireMockSubRepo.
type subRepoStore struct {
	mu      sync.Mutex
	sub     *domain.Subscription
	err     error
	listRet []domain.Subscription
}

// wireMockSubRepo — domain.Repo с поведением как у in-memory store.
func wireMockSubRepo(ctrl *gomock.Controller, s *subRepoStore) *submocks.MockRepo {
	m := submocks.NewMockRepo(ctrl)
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID) (domain.Subscription, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.err != nil {
				return domain.Subscription{}, s.err
			}
			if s.sub == nil {
				return domain.Subscription{}, domain.ErrNotFound
			}
			return *s.sub, nil
		},
	).AnyTimes()
	m.EXPECT().Upsert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, sub domain.Subscription) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.sub = &sub
			return nil
		},
	).AnyTimes()
	m.EXPECT().ListByPlan(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ domain.Tier, _, _ int) ([]domain.Subscription, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.listRet, nil
		},
	).AnyTimes()
	m.EXPECT().MarkExpired(gomock.Any(), gomock.Any()).Return(int64(0), nil).AnyTimes()
	m.EXPECT().ListExpiringTrials(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	return m
}

// newSubRepoStore — пустой store с пустыми maps.
func newSubRepoStore() *subRepoStore { return &subRepoStore{} }

func TestGetTier_NoRow_ReturnsFree(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := NewGetTier(wireMockSubRepo(ctrl, newSubRepoStore()), fakeClock{now: time.Now()})
	tier, err := uc.Do(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if tier != domain.TierFree {
		t.Fatalf("want TierFree, got %s", tier)
	}
}

func TestGetTier_RepoErr_Propagates(t *testing.T) {
	ctrl := gomock.NewController(t)
	repoErr := errors.New("pg down")
	store := &subRepoStore{err: repoErr}
	uc := NewGetTier(wireMockSubRepo(ctrl, store), fakeClock{now: time.Now()})
	_, err := uc.Do(context.Background(), uuid.New())
	if err == nil || !errors.Is(err, repoErr) {
		t.Fatalf("want pg down wrapped, got %v", err)
	}
}

func TestGetTier_ExpiredPastGrace_ReturnsFree(t *testing.T) {
	ctrl := gomock.NewController(t)
	now := time.Now().UTC()
	past := now.Add(-48 * time.Hour)
	sub := domain.Subscription{
		Tier: domain.TierPro, Status: domain.StatusActive,
		CurrentPeriodEnd: &past, GraceUntil: &past,
	}
	store := &subRepoStore{sub: &sub}
	uc := NewGetTier(wireMockSubRepo(ctrl, store), fakeClock{now: now})
	tier, _ := uc.Do(context.Background(), uuid.New())
	if tier != domain.TierFree {
		t.Fatalf("expired must degrade, got %s", tier)
	}
}

func TestGetTier_ActivePro_Returns(t *testing.T) {
	ctrl := gomock.NewController(t)
	now := time.Now().UTC()
	future := now.Add(24 * time.Hour)
	sub := domain.Subscription{
		Tier: domain.TierPro, Status: domain.StatusActive, CurrentPeriodEnd: &future,
	}
	store := &subRepoStore{sub: &sub}
	uc := NewGetTier(wireMockSubRepo(ctrl, store), fakeClock{now: now})
	tier, _ := uc.Do(context.Background(), uuid.New())
	if tier != domain.TierPro {
		t.Fatalf("want pro, got %s", tier)
	}
}

func TestGetTier_DoFull_NoRow_ReturnsSynthetic(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := NewGetTier(wireMockSubRepo(ctrl, newSubRepoStore()), fakeClock{now: time.Now()})
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
