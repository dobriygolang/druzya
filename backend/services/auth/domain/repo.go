//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ErrNotFound is returned by repos when the requested record does not exist.
// Repos must translate pgx.ErrNoRows into this sentinel; use cases compare with errors.Is.
var ErrNotFound = errors.New("auth: not found")

// UserRepo persists users and their linked oauth accounts.
type UserRepo interface {
	// UpsertByOAuth looks up the oauth_accounts row by (provider, providerUserID).
	// If found, returns the linked user (optionally touching the account).
	// If not found, creates user + oauth_accounts in a single transaction and
	// returns the new user with `created` = true.
	UpsertByOAuth(ctx context.Context, in UpsertOAuthInput) (User, bool /*created*/, error)

	FindByID(ctx context.Context, id uuid.UUID) (User, error)
	FindByUsername(ctx context.Context, username string) (User, error)
}

// UpsertOAuthInput carries everything needed to create-or-find a user from
// an external identity. Encrypted token blobs are passed opaque.
type UpsertOAuthInput struct {
	Provider         enums.AuthProvider
	ProviderUserID   string
	Email            string // may be empty (Telegram)
	UsernameHint     string // preferred login/username; repo dedupes on conflict
	DisplayName      string
	AccessTokenEnc   []byte
	RefreshTokenEnc  []byte
	TokenExpiresAt   *time.Time
}

// SessionRepo stores refresh sessions in Redis. Keys namespaced session:{id}.
type SessionRepo interface {
	Create(ctx context.Context, s Session) error
	Get(ctx context.Context, id uuid.UUID) (Session, error)
	Delete(ctx context.Context, id uuid.UUID) error
}

// RateLimiter is a Redis-backed fixed-window counter. Returns ErrRateLimited
// when the caller has exceeded the quota for the current window.
type RateLimiter interface {
	// Allow increments the counter for `key` in the current window.
	// Returns (remaining, retryAfterSec, err). When the limit is hit,
	// err is ErrRateLimited and retryAfterSec is the TTL left in the window.
	Allow(ctx context.Context, key string, limit int, window time.Duration) (remaining int, retryAfter int, err error)
}

// ErrRateLimited indicates the caller exceeded the window quota.
var ErrRateLimited = errors.New("auth: rate limited")
