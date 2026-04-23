//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ErrNotFound возвращается репозиториями, когда запрошенной записи нет.
// Репо обязаны транслировать pgx.ErrNoRows в этот sentinel; use cases
// сравнивают через errors.Is.
var ErrNotFound = errors.New("auth: not found")

// UserRepo сохраняет пользователей и их привязанные oauth-аккаунты.
type UserRepo interface {
	// UpsertByOAuth ищет строку oauth_accounts по (provider, providerUserID).
	// Если найдена — возвращает связанного пользователя (опционально обновляя
	// аккаунт). Если не найдена — создаёт user + oauth_accounts одной
	// транзакцией и возвращает нового пользователя с created=true.
	UpsertByOAuth(ctx context.Context, in UpsertOAuthInput) (User, bool /*created*/, error)

	FindByID(ctx context.Context, id uuid.UUID) (User, error)
	FindByUsername(ctx context.Context, username string) (User, error)
}

// UpsertOAuthInput несёт всё нужное, чтобы создать или найти пользователя
// по внешней идентичности. Зашифрованные блобы токенов передаются как непрозрачные.
type UpsertOAuthInput struct {
	Provider        enums.AuthProvider
	ProviderUserID  string
	Email           string // может быть пустым (Telegram)
	UsernameHint    string // предпочитаемый login/username; репо дедуплицирует при конфликте
	DisplayName     string
	AvatarURL       string // URL аватара провайдера; пустой → не пишем (КРОМЕ insert: пишем '').
	AccessTokenEnc  []byte
	RefreshTokenEnc []byte
	TokenExpiresAt  *time.Time
}

// SessionRepo хранит refresh-сессии в Redis. Ключи в неймспейсе session:{id}.
type SessionRepo interface {
	Create(ctx context.Context, s Session) error
	Get(ctx context.Context, id uuid.UUID) (Session, error)
	Delete(ctx context.Context, id uuid.UUID) error
}

// RateLimiter — счётчик с фиксированным окном в Redis. Возвращает ErrRateLimited,
// когда вызывающий превысил квоту для текущего окна.
type RateLimiter interface {
	// Allow инкрементирует счётчик `key` в текущем окне.
	// Возвращает (remaining, retryAfterSec, err). При превышении лимита
	// err = ErrRateLimited, а retryAfterSec — оставшийся TTL окна.
	Allow(ctx context.Context, key string, limit int, window time.Duration) (remaining int, retryAfter int, err error)
}

// ErrRateLimited означает, что вызывающий превысил квоту окна.
var ErrRateLimited = errors.New("auth: rate limited")
