// Package infra contains concrete adapters for the auth domain:
// Postgres user/oauth repo (thin wrapper over sqlc-generated authdb.Queries),
// Redis session repo + rate limiter, Yandex OAuth HTTP client, and the
// AES-256-GCM token encryptor.
package infra

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	authdb "druz9/auth/infra/db"
	"druz9/auth/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.UserRepo against PostgreSQL via the sqlc-generated
// authdb.Queries. The few multi-statement operations that sqlc can't express
// (UpsertByOAuth = 3 queries in one tx) are composed here from the typed
// single-query primitives.
type Postgres struct {
	pool *pgxpool.Pool
	q    *authdb.Queries
}

// NewPostgres wraps a pgxpool.Pool and prepares a Queries handle.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: authdb.New(pool)}
}

// UpsertByOAuth is atomic: find the oauth_accounts row, update token blobs
// on hit, otherwise insert user + oauth_accounts in a single transaction.
// NOTE: sqlc generates one query per SQL statement — the tx boundary plus
// the username-collision loop are composed here, not in generated code.
func (p *Postgres) UpsertByOAuth(ctx context.Context, in domain.UpsertOAuthInput) (domain.User, bool, error) {
	if !in.Provider.IsValid() {
		return domain.User{}, false, fmt.Errorf("auth.Postgres.UpsertByOAuth: invalid provider %q", in.Provider)
	}
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return domain.User{}, false, fmt.Errorf("auth.Postgres.UpsertByOAuth: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := p.q.WithTx(tx)

	// 1. Existing link?
	linkedID, err := qtx.FindOAuthLink(ctx, authdb.FindOAuthLinkParams{
		Provider:       string(in.Provider),
		ProviderUserID: in.ProviderUserID,
	})
	switch {
	case err == nil:
		// Found. Update tokens opportunistically.
		if err := qtx.TouchOAuthTokens(ctx, authdb.TouchOAuthTokensParams{
			Provider:        string(in.Provider),
			ProviderUserID:  in.ProviderUserID,
			AccessTokenEnc:  in.AccessTokenEnc,
			RefreshTokenEnc: in.RefreshTokenEnc,
			TokenExpiresAt:  toTimestamptz(in.TokenExpiresAt),
		}); err != nil {
			return domain.User{}, false, fmt.Errorf("auth.Postgres.UpsertByOAuth: touch tokens: %w", err)
		}
		row, err := qtx.FindUserByID(ctx, linkedID)
		if err != nil {
			return domain.User{}, false, fmt.Errorf("auth.Postgres.UpsertByOAuth: load existing user: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return domain.User{}, false, fmt.Errorf("auth.Postgres.UpsertByOAuth: commit: %w", err)
		}
		u, err := userFromFindRow(row)
		if err != nil {
			return domain.User{}, false, fmt.Errorf("auth.Postgres.UpsertByOAuth: %w", err)
		}
		return u, false, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return domain.User{}, false, fmt.Errorf("auth.Postgres.UpsertByOAuth: lookup oauth: %w", err)
	}

	// 2. No link → create user + oauth row. Resolve username collisions.
	// NOTE: dynamic username-uniqueness probe, sqlc can't generate the loop — keep hand-rolled.
	username, err := ensureUniqueUsername(ctx, qtx, in.UsernameHint)
	if err != nil {
		return domain.User{}, false, fmt.Errorf("auth.Postgres.UpsertByOAuth: resolve username: %w", err)
	}
	role := enums.UserRoleUser
	created, err := qtx.CreateUser(ctx, authdb.CreateUserParams{
		Column1:  in.Email, // NULLIF($1,'') handles empty string
		Username: username,
		Role:     role.String(),
		Locale:   "ru",
		Column5:  in.DisplayName,
	})
	if err != nil {
		return domain.User{}, false, fmt.Errorf("auth.Postgres.UpsertByOAuth: insert user: %w", err)
	}
	if err := qtx.CreateOAuthAccount(ctx, authdb.CreateOAuthAccountParams{
		UserID:          created.ID,
		Provider:        string(in.Provider),
		ProviderUserID:  in.ProviderUserID,
		AccessTokenEnc:  in.AccessTokenEnc,
		RefreshTokenEnc: in.RefreshTokenEnc,
		TokenExpiresAt:  toTimestamptz(in.TokenExpiresAt),
	}); err != nil {
		return domain.User{}, false, fmt.Errorf("auth.Postgres.UpsertByOAuth: insert oauth: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.User{}, false, fmt.Errorf("auth.Postgres.UpsertByOAuth: commit: %w", err)
	}
	u, err := userFromCreateRow(created)
	if err != nil {
		return domain.User{}, false, fmt.Errorf("auth.Postgres.UpsertByOAuth: %w", err)
	}
	return u, true, nil
}

// FindByID loads a user by primary key.
func (p *Postgres) FindByID(ctx context.Context, id uuid.UUID) (domain.User, error) {
	row, err := p.q.FindUserByID(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.User{}, fmt.Errorf("auth.Postgres.FindByID: %w", domain.ErrNotFound)
		}
		return domain.User{}, fmt.Errorf("auth.Postgres.FindByID: %w", err)
	}
	u, err := userFromFindRow(row)
	if err != nil {
		return domain.User{}, fmt.Errorf("auth.Postgres.FindByID: %w", err)
	}
	return u, nil
}

// FindByUsername loads a user by case-sensitive username.
func (p *Postgres) FindByUsername(ctx context.Context, username string) (domain.User, error) {
	row, err := p.q.FindUserByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.User{}, fmt.Errorf("auth.Postgres.FindByUsername: %w", domain.ErrNotFound)
		}
		return domain.User{}, fmt.Errorf("auth.Postgres.FindByUsername: %w", err)
	}
	u, err := userFromFindUsernameRow(row)
	if err != nil {
		return domain.User{}, fmt.Errorf("auth.Postgres.FindByUsername: %w", err)
	}
	return u, nil
}

// ── helpers ────────────────────────────────────────────────────────────────

// ensureUniqueUsername appends a short random suffix if the preferred username
// already exists. We do not claim the row here — the subsequent INSERT carries
// the unique constraint; rare races return as 23505.
// NOTE: dynamic probe loop, sqlc can't generate it — hand-rolled wrapping
// around the generated UsernameExists :one query.
func ensureUniqueUsername(ctx context.Context, q *authdb.Queries, hint string) (string, error) {
	hint = strings.TrimSpace(hint)
	if hint == "" {
		hint = "user_" + uuid.New().String()[:8]
	}
	for i := 0; i < 5; i++ {
		candidate := hint
		if i > 0 {
			candidate = fmt.Sprintf("%s_%s", hint, uuid.New().String()[:4])
		}
		exists, err := q.UsernameExists(ctx, candidate)
		if err != nil {
			return "", fmt.Errorf("check username: %w", err)
		}
		if !exists {
			return candidate, nil
		}
	}
	return fmt.Sprintf("%s_%s", hint, uuid.New().String()[:8]), nil
}

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func pgText(s pgtype.Text) string {
	if !s.Valid {
		return ""
	}
	return s.String
}

func toTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

// userFromFindRow maps authdb.FindUserByIDRow to domain.User.
func userFromFindRow(r authdb.FindUserByIDRow) (domain.User, error) {
	role := enums.UserRole(r.Role)
	if !role.IsValid() {
		return domain.User{}, fmt.Errorf("invalid role %q from db", r.Role)
	}
	return domain.User{
		ID:          fromPgUUID(r.ID),
		Email:       pgText(r.Email),
		Username:    r.Username,
		Role:        role,
		Locale:      r.Locale,
		DisplayName: pgText(r.DisplayName),
		CreatedAt:   r.CreatedAt.Time,
		UpdatedAt:   r.UpdatedAt.Time,
	}, nil
}

func userFromFindUsernameRow(r authdb.FindUserByUsernameRow) (domain.User, error) {
	return userFromFindRow(authdb.FindUserByIDRow(r))
}

func userFromCreateRow(r authdb.CreateUserRow) (domain.User, error) {
	return userFromFindRow(authdb.FindUserByIDRow(r))
}
