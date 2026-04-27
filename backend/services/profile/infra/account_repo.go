package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/profile/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Account implements domain.AccountRepo via direct pgx.
type Account struct {
	pool *pgxpool.Pool
}

// NewAccount wraps a pool.
func NewAccount(pool *pgxpool.Pool) *Account {
	return &Account{pool: pool}
}

// GetUsername returns the current username for the user-id, or
// domain.ErrNotFound when no row exists.
func (a *Account) GetUsername(ctx context.Context, userID uuid.UUID) (string, error) {
	var username string
	if err := a.pool.QueryRow(ctx,
		`SELECT username FROM users WHERE id = $1`, sharedpg.UUID(userID)).
		Scan(&username); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", domain.ErrNotFound
		}
		return "", fmt.Errorf("profile.Account.GetUsername: %w", err)
	}
	return username, nil
}

// DeleteUser hard-deletes the user row. CASCADE on FK takes care of the
// owned tables (see migrations).
func (a *Account) DeleteUser(ctx context.Context, userID uuid.UUID) error {
	tag, err := a.pool.Exec(ctx,
		`DELETE FROM users WHERE id = $1`, sharedpg.UUID(userID))
	if err != nil {
		return fmt.Errorf("profile.Account.DeleteUser: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
