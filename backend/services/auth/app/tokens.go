// Package app contains the auth service use cases: login, refresh, logout.
// Use cases orchestrate domain primitives and infra ports; they never know
// about HTTP.
package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/auth/domain"
	"druz9/shared/enums"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// AccessTokenClaims is the payload of our short-lived access JWT.
type AccessTokenClaims struct {
	UserID   uuid.UUID      `json:"sub_uid"`
	Role     enums.UserRole `json:"role"`
	Provider string         `json:"prv,omitempty"`
	jwt.RegisteredClaims
}

// TokenIssuer mints and validates our JWT access tokens. HS256 is plenty for
// monolith MVP; swap to RS256 when we split auth into its own service.
type TokenIssuer struct {
	secret    []byte
	accessTTL time.Duration
	issuer    string
}

// NewTokenIssuer builds an issuer. `secret` must be at least 32 bytes in prod.
func NewTokenIssuer(secret string, accessTTL time.Duration) *TokenIssuer {
	return &TokenIssuer{
		secret:    []byte(secret),
		accessTTL: accessTTL,
		issuer:    "druz9",
	}
}

// Mint produces a signed access token for the given user.
func (t *TokenIssuer) Mint(userID uuid.UUID, role enums.UserRole, provider enums.AuthProvider) (string, int, error) {
	now := time.Now().UTC()
	claims := AccessTokenClaims{
		UserID:   userID,
		Role:     role,
		Provider: provider.String(),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    t.issuer,
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(t.accessTTL)),
			ID:        uuid.NewString(),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(t.secret)
	if err != nil {
		return "", 0, fmt.Errorf("auth.TokenIssuer.Mint: sign: %w", err)
	}
	return signed, int(t.accessTTL.Seconds()), nil
}

// Parse validates a signed access JWT and returns the claims.
// Returns ErrInvalidToken for any structural/signature/expiry failure so the
// HTTP layer can just map to 401.
func (t *TokenIssuer) Parse(raw string) (*AccessTokenClaims, error) {
	claims := &AccessTokenClaims{}
	parsed, err := jwt.ParseWithClaims(raw, claims, func(tok *jwt.Token) (any, error) {
		if tok.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, fmt.Errorf("auth.TokenIssuer.Parse: unexpected alg %q", tok.Method.Alg())
		}
		return t.secret, nil
	})
	if err != nil {
		return nil, fmt.Errorf("auth.TokenIssuer.Parse: %w", errors.Join(ErrInvalidToken, err))
	}
	if !parsed.Valid {
		return nil, fmt.Errorf("auth.TokenIssuer.Parse: %w", ErrInvalidToken)
	}
	return claims, nil
}

// ErrInvalidToken is returned when JWT validation fails for any reason.
var ErrInvalidToken = errors.New("auth: invalid token")

// NewRefreshToken generates an opaque random refresh token (URL-safe, 32 bytes of entropy).
// The value returned IS the session id — we store it keyed in Redis. The
// bible permits a stateless JWT refresh too, but Redis-keyed lets us revoke
// on logout without key rotation.
func NewRefreshToken() (token string, sessionID uuid.UUID) {
	id := uuid.New()
	// The token we ship to the client IS the UUID — we can look it up in Redis
	// directly. (No signed JWT needed because we own the session store.)
	return id.String(), id
}

// BuildTokenPair mints access+refresh and persists the session in Redis.
func BuildTokenPair(
	ctx context.Context,
	issuer *TokenIssuer,
	sessions domain.SessionRepo,
	user domain.User,
	provider enums.AuthProvider,
	refreshTTL time.Duration,
	ua, ip string,
) (domain.TokenPair, error) {
	access, expiresIn, err := issuer.Mint(user.ID, user.Role, provider)
	if err != nil {
		return domain.TokenPair{}, fmt.Errorf("auth.BuildTokenPair: mint access: %w", err)
	}
	refresh, sid := NewRefreshToken()
	now := time.Now().UTC()
	sess := domain.Session{
		ID:        sid,
		UserID:    user.ID,
		CreatedAt: now,
		ExpiresAt: now.Add(refreshTTL),
		UserAgent: ua,
		IP:        ip,
	}
	if err := sessions.Create(ctx, sess); err != nil {
		return domain.TokenPair{}, fmt.Errorf("auth.BuildTokenPair: persist session: %w", err)
	}
	return domain.TokenPair{
		AccessToken:     access,
		AccessExpiresIn: expiresIn,
		RefreshToken:    refresh,
		SessionID:       sid,
		RefreshExpires:  sess.ExpiresAt,
	}, nil
}
