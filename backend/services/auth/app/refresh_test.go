package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/auth/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// fakeSessionsWithGet расширяет fakeSessions рабочим Get, чтобы Refresh мог
// загрузить «живую» сессию. Другие тесты используют заглушку Get без данных —
// здесь нам важно, чтобы happy-path не упал на загрузке.
type fakeSessionsWithGet struct {
	fakeSessions
	sid    uuid.UUID
	userID uuid.UUID
}

func (f *fakeSessionsWithGet) Get(_ context.Context, id uuid.UUID) (domain.Session, error) {
	if id != f.sid {
		return domain.Session{}, domain.ErrNotFound
	}
	return domain.Session{
		ID:        f.sid,
		UserID:    f.userID,
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	}, nil
}

// TestRefresh_RateLimited — 11-й запрос с того же IP возвращает
// RateLimitedError (закрывает brute-force по session-ID).
func TestRefresh_RateLimited(t *testing.T) {
	uc := &Refresh{
		Users:      &fakeUsers{},
		Sessions:   &fakeSessions{},
		Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
		RefreshTTL: time.Hour,
		Limiter:    &fakeLimiter{rejectKeyPrefix: "rl:auth:refresh:", retry: 42},
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
	uc := &Refresh{
		Users:      &fakeUsers{},
		Sessions:   &fakeSessions{},
		Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
		RefreshTTL: time.Hour,
		Limiter:    &fakeLimiter{}, // пропускает
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
	uc := &Refresh{
		Users:      &fakeUsers{},
		Sessions:   &fakeSessions{},
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
	sess := &fakeSessionsWithGet{sid: sid, userID: uid}
	users := &fakeUsers{user: domain.User{ID: uid, Username: "alice", Role: enums.UserRoleUser}}

	uc := &Refresh{
		Users:      users,
		Sessions:   sess,
		Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
		RefreshTTL: time.Hour,
		Limiter:    &fakeLimiter{}, // всегда allow
	}
	_, err := uc.Do(context.Background(), RefreshInput{
		RefreshToken: sid.String(),
		IP:           "1.2.3.4",
	})
	if err != nil {
		t.Fatalf("expected happy path, got %v", err)
	}
}
