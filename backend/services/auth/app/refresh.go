package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/auth/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Refresh rotates the access token using a live refresh-token cookie.
// On success the old session is revoked and a new one is created (token rotation).
type Refresh struct {
	Users      domain.UserRepo
	Sessions   domain.SessionRepo
	Issuer     *TokenIssuer
	RefreshTTL time.Duration
}

// RefreshInput carries the refresh-token cookie value and request metadata.
type RefreshInput struct {
	RefreshToken string
	IP           string
	UserAgent    string
}

// RefreshResult holds the freshly-minted pair.
type RefreshResult struct {
	Tokens domain.TokenPair
	User   domain.User
}

// Do validates the refresh token, rotates the session, and mints a new access token.
func (uc *Refresh) Do(ctx context.Context, in RefreshInput) (RefreshResult, error) {
	sid, err := uuid.Parse(in.RefreshToken)
	if err != nil {
		return RefreshResult{}, fmt.Errorf("auth.Refresh: parse refresh token: %w", ErrInvalidToken)
	}
	sess, err := uc.Sessions.Get(ctx, sid)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return RefreshResult{}, fmt.Errorf("auth.Refresh: %w", ErrInvalidToken)
	case err != nil:
		return RefreshResult{}, fmt.Errorf("auth.Refresh: load session: %w", err)
	}
	if sess.ExpiresAt.Before(time.Now().UTC()) {
		// Tidy the store and reject.
		_ = uc.Sessions.Delete(ctx, sid)
		return RefreshResult{}, fmt.Errorf("auth.Refresh: %w", ErrInvalidToken)
	}
	user, err := uc.Users.FindByID(ctx, sess.UserID)
	if err != nil {
		return RefreshResult{}, fmt.Errorf("auth.Refresh: load user: %w", err)
	}
	// Rotate: delete old session, create new.
	if err := uc.Sessions.Delete(ctx, sid); err != nil {
		return RefreshResult{}, fmt.Errorf("auth.Refresh: revoke old session: %w", err)
	}
	// Provider is carried on the access-token claims but we don't know it here —
	// default to Yandex for the claim. (A production system would persist it on
	// the session row; tracked as a follow-up.)
	// STUB: persist provider on session row so Refresh can round-trip it.
	pair, err := BuildTokenPair(ctx, uc.Issuer, uc.Sessions, user, enums.AuthProviderYandex, uc.RefreshTTL, in.UserAgent, in.IP)
	if err != nil {
		return RefreshResult{}, fmt.Errorf("auth.Refresh: build tokens: %w", err)
	}
	return RefreshResult{Tokens: pair, User: user}, nil
}
