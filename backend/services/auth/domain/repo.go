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

// OAuthStateStore связывает одноразовый CSRF-токен `state` с PKCE-верификатором
// на время OAuth-редиректа. Реализация держит пары в Redis с TTL ≈10 мин.
//
// Порядок жизненного цикла:
//  1. StartLoginYandex → SaveState(state, codeVerifier, ttl)
//  2. Callback (LoginYandex) → ConsumeState(state) удаляет ключ атомарно
//     (GETDEL) и возвращает сохранённый codeVerifier. Повторный вызов
//     вернёт ErrStateNotFound — это гарантирует one-shot использование и
//     блокирует CSRF-replay.
type OAuthStateStore interface {
	// SaveState сохраняет пару {state → codeVerifier} с TTL.
	SaveState(ctx context.Context, state, codeVerifier string, ttl time.Duration) error
	// ConsumeState атомарно читает и удаляет state. При отсутствии ключа —
	// ErrStateNotFound (истёк, не существовал или уже использовался).
	ConsumeState(ctx context.Context, state string) (codeVerifier string, err error)
}

// ErrStateNotFound возвращается OAuthStateStore, когда state не найден —
// обычно из-за истечения TTL, повторного использования или CSRF-подделки.
var ErrStateNotFound = errors.New("auth: oauth state not found")
