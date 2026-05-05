package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/copilot/domain"
	"druz9/copilot/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// TestStartSession_RateLimited — 11-й старт подряд для одного юзера падает
// в ErrRateLimited; 10 первых проходят.
func TestStartSession_RateLimited(t *testing.T) {
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	sessions := mocks.NewMockSessionRepo(ctrl)
	createCalls := 0
	sessions.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID, kind domain.SessionKind) (domain.Session, error) {
			createCalls++
			return domain.Session{ID: uuid.New(), UserID: userID, Kind: kind}, nil
		},
	).Times(10)

	limiter := mocks.NewMockRateLimiter(ctrl)
	calls := 0
	limiter.EXPECT().Allow(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ string, limit int, _ time.Duration) (int, int, error) {
			calls++
			if calls > limit {
				return 0, 60, domain.ErrRateLimited
			}
			return limit - calls, 0, nil
		},
	).AnyTimes()

	uc := &StartSession{Sessions: sessions, Limiter: limiter}

	for i := 0; i < 10; i++ {
		if _, err := uc.Do(context.Background(), StartSessionInput{
			UserID: uid, Kind: domain.SessionKindInterview,
		}); err != nil {
			t.Fatalf("call %d: unexpected err %v", i+1, err)
		}
	}
	_, err := uc.Do(context.Background(), StartSessionInput{
		UserID: uid, Kind: domain.SessionKindInterview,
	})
	if !errors.Is(err, domain.ErrRateLimited) {
		t.Fatalf("expected ErrRateLimited on 11th call, got %v", err)
	}
	if createCalls != 10 {
		t.Fatalf("Create calls=%d, want 10 (лимит пропустил только первые 10)", createCalls)
	}
}

// TestStartSession_RateLimitPerUser — лимит считается per-user, а не per-IP
// или глобально: второй юзер стартует успешно даже после того, как первый
// выбрал квоту.
func TestStartSession_RateLimitPerUser(t *testing.T) {
	ctrl := gomock.NewController(t)
	sessions := mocks.NewMockSessionRepo(ctrl)
	sessions.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID, kind domain.SessionKind) (domain.Session, error) {
			return domain.Session{ID: uuid.New(), UserID: userID, Kind: kind}, nil
		},
	).AnyTimes()

	limiter := mocks.NewMockRateLimiter(ctrl)
	counts := map[string]int{}
	limiter.EXPECT().Allow(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, key string, limit int, _ time.Duration) (int, int, error) {
			counts[key]++
			if counts[key] > limit {
				return 0, 60, domain.ErrRateLimited
			}
			return limit - counts[key], 0, nil
		},
	).AnyTimes()

	uc := &StartSession{Sessions: sessions, Limiter: limiter}

	alice := uuid.New()
	bob := uuid.New()

	// Alice исчерпывает квоту.
	for i := 0; i < 10; i++ {
		if _, err := uc.Do(context.Background(), StartSessionInput{
			UserID: alice, Kind: domain.SessionKindInterview,
		}); err != nil {
			t.Fatalf("alice call %d: %v", i+1, err)
		}
	}
	if _, err := uc.Do(context.Background(), StartSessionInput{
		UserID: alice, Kind: domain.SessionKindInterview,
	}); !errors.Is(err, domain.ErrRateLimited) {
		t.Fatalf("alice 11th: expected ErrRateLimited, got %v", err)
	}

	// Боб — с чистого листа, ему лимит Alice не касается.
	if _, err := uc.Do(context.Background(), StartSessionInput{
		UserID: bob, Kind: domain.SessionKindInterview,
	}); err != nil {
		t.Fatalf("bob first call got %v", err)
	}
}

// TestStartSession_NoLimiter — use case работает и без limiter'а (nil-safe).
// Нужен для совместимости с тестами, которые limiter не создают.
func TestStartSession_NoLimiter(t *testing.T) {
	ctrl := gomock.NewController(t)
	sessions := mocks.NewMockSessionRepo(ctrl)
	sessions.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID, kind domain.SessionKind) (domain.Session, error) {
			return domain.Session{ID: uuid.New(), UserID: userID, Kind: kind}, nil
		},
	)
	uc := &StartSession{Sessions: sessions /* Limiter nil */}
	if _, err := uc.Do(context.Background(), StartSessionInput{
		UserID: uuid.New(), Kind: domain.SessionKindInterview,
	}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}
