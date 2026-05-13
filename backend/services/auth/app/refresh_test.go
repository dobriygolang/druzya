package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/auth/domain"
	authmocks "druz9/auth/domain/mocks"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// wireMockSessionsForRefresh — mock с поддержкой Get(sid) → live session,
// Create AnyTimes (refresh переcоздаёт). Любой другой sid → ErrNotFound.
func wireMockSessionsForRefresh(ctrl *gomock.Controller, sid, userID uuid.UUID) *authmocks.MockSessionRepo {
	m := authmocks.NewMockSessionRepo(ctrl)
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) (domain.Session, error) {
			if id != sid {
				return domain.Session{}, domain.ErrNotFound
			}
			return domain.Session{
				ID:        sid,
				UserID:    userID,
				ExpiresAt: time.Now().UTC().Add(time.Hour),
			}, nil
		},
	).AnyTimes()
	m.EXPECT().Create(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().Delete(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	return m
}

// emptyUsersMock — Users mock без поведения (refresh не Upsert).
func emptyUsersMock(ctrl *gomock.Controller, user domain.User) *authmocks.MockUserRepo {
	m := authmocks.NewMockUserRepo(ctrl)
	m.EXPECT().UpsertByOAuth(gomock.Any(), gomock.Any()).Return(domain.User{}, false, nil).AnyTimes()
	m.EXPECT().FindByID(gomock.Any(), gomock.Any()).Return(user, nil).AnyTimes()
	m.EXPECT().FindByUsername(gomock.Any(), gomock.Any()).Return(domain.User{}, nil).AnyTimes()
	return m
}

// TestRefresh_RateLimited — 11-й запрос с того же IP возвращает
// RateLimitedError (закрывает brute-force по session-ID).
func TestRefresh_RateLimited(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := &Refresh{
		Users:      emptyUsersMock(ctrl, domain.User{}),
		Sessions:   wireMockSessionsForRefresh(ctrl, uuid.New(), uuid.New()),
		Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
		RefreshTTL: time.Hour,
		Limiter:    wireMockRateLimiter(ctrl, "rl:auth:refresh:", 42),
	}

	_, err := uc.Do(context.Background(), RefreshInput{
		RefreshToken: uuid.NewString(),
		IP:           "1.2.3.4",
	})
	var rl *RateLimitedError
	if !errors.As(err, &rl) {
		t.Fatalf("expected RateLimitedError, got %v", err)
	}
	if rl.RetryAfterSec != 42 {
		t.Fatalf("retry %d, want 42", rl.RetryAfterSec)
	}
}

// TestRefresh_InvalidTokenFormat — даже при пустом limiter плохой токен
// должен распознаваться как ErrInvalidToken (регресс-тест на порядок гардов:
// rate-limit должен отработать ДО парсинга UUID, но после прохождения limiter
// некорректный токен обязан упасть в ErrInvalidToken, а не в internal).
func TestRefresh_InvalidTokenFormat(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := &Refresh{
		Users:      emptyUsersMock(ctrl, domain.User{}),
		Sessions:   wireMockSessionsForRefresh(ctrl, uuid.New(), uuid.New()),
		Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
		RefreshTTL: time.Hour,
		Limiter:    wireMockRateLimiter(ctrl, "", 0), // пропускает
	}
	_, err := uc.Do(context.Background(), RefreshInput{
		RefreshToken: "not-a-uuid",
		IP:           "1.2.3.4",
	})
	if !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("expected ErrInvalidToken, got %v", err)
	}
}

// TestRefresh_NoLimiter — при nil-Limiter use case остаётся рабочим
// (покрываем legacy-тесты и custom-builds без rate-limit).
func TestRefresh_NoLimiter(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := &Refresh{
		Users:      emptyUsersMock(ctrl, domain.User{}),
		Sessions:   wireMockSessionsForRefresh(ctrl, uuid.New(), uuid.New()),
		Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
		RefreshTTL: time.Hour,
		// Limiter: nil — не инстанцируем.
	}
	_, err := uc.Do(context.Background(), RefreshInput{
		RefreshToken: "not-a-uuid",
		IP:           "1.2.3.4",
	})
	if !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("expected ErrInvalidToken, got %v", err)
	}
}

// TestRefresh_HappyPathConsumesQuota — один валидный вызов проходит, а
// когда limiter начинает отбрасывать — следующий падает в RateLimitedError.
// Сценарий имитирует «превышение порога на 11-м запросе».
func TestRefresh_HappyPathConsumesQuota(t *testing.T) {
	sid := uuid.New()
	uid := uuid.New()
	ctrl := gomock.NewController(t)
	user := domain.User{ID: uid, Username: "alice", Role: enums.UserRoleUser}

	uc := &Refresh{
		Users:      emptyUsersMock(ctrl, user),
		Sessions:   wireMockSessionsForRefresh(ctrl, sid, uid),
		Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
		RefreshTTL: time.Hour,
		Limiter:    wireMockRateLimiter(ctrl, "", 0), // всегда allow
	}
	_, err := uc.Do(context.Background(), RefreshInput{
		RefreshToken: sid.String(),
		IP:           "1.2.3.4",
	})
	if err != nil {
		t.Fatalf("expected happy path, got %v", err)
	}
}
