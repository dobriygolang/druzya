// byok_repo.go — Postgres-адаптер для user_byok_keys (миграция 00089).
// Использует raw pgxpool — таблица узкая (1 row per user), sqlc-codegen
// overkill.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BYOKRepo — конкретная реализация domain.BYOKRepo.
type BYOKRepo struct {
	pool *pgxpool.Pool
}

// NewBYOKRepo — конструктор.
func NewBYOKRepo(pool *pgxpool.Pool) *BYOKRepo {
	return &BYOKRepo{pool: pool}
}

// Compile-time assertion.
var _ domain.BYOKRepo = (*BYOKRepo)(nil)

// Get возвращает запись или ErrNotFound.
func (r *BYOKRepo) Get(ctx context.Context, userID uuid.UUID) (domain.BYOKKey, error) {
	const q = `
		SELECT user_id, provider, api_key_encrypted, validated_at, created_at, updated_at
		  FROM user_byok_keys
		 WHERE user_id = $1`
	row := r.pool.QueryRow(ctx, q, userID)
	var (
		out             domain.BYOKKey
		validatedAt     *time.Time
		provider        string
	)
	if err := row.Scan(&out.UserID, &provider, &out.APIKeyCipher, &validatedAt, &out.CreatedAt, &out.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.BYOKKey{}, domain.ErrNotFound
		}
		return domain.BYOKKey{}, fmt.Errorf("subscription.byok.Get: %w", err)
	}
	out.Provider = domain.BYOKProvider(provider)
	out.ValidatedAt = validatedAt
	return out, nil
}

// Upsert — идемпотентная запись по user_id.
func (r *BYOKRepo) Upsert(ctx context.Context, k domain.BYOKKey) error {
	const q = `
		INSERT INTO user_byok_keys (user_id, provider, api_key_encrypted, validated_at, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (user_id) DO UPDATE
		   SET provider          = EXCLUDED.provider,
		       api_key_encrypted = EXCLUDED.api_key_encrypted,
		       validated_at      = EXCLUDED.validated_at,
		       updated_at        = now()`
	if _, err := r.pool.Exec(ctx, q, k.UserID, string(k.Provider), k.APIKeyCipher, k.ValidatedAt); err != nil {
		return fmt.Errorf("subscription.byok.Upsert: %w", err)
	}
	return nil
}

// Delete — снимает BYOK для юзера.
func (r *BYOKRepo) Delete(ctx context.Context, userID uuid.UUID) error {
	const q = `DELETE FROM user_byok_keys WHERE user_id = $1`
	if _, err := r.pool.Exec(ctx, q, userID); err != nil {
		return fmt.Errorf("subscription.byok.Delete: %w", err)
	}
	return nil
}
