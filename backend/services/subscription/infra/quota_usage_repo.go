// quota_usage_repo.go — Postgres implementation of subApp.UsageReader.
//
// Counts live across foreign tables (notes / whiteboard_rooms / editor_rooms)
// owned by other domains. We hold those queries here as raw SQL on purpose:
// importing the other domains' infra packages would create a circular
// dependency, and the count semantics are stable (single column, simple
// WHERE) — duplicating them is cheaper than threading three more interfaces.
//
// Mirror of the pre-refactor `subscriptionUsageAdapter` lived in
// cmd/monolith/services/subscription/subscription.go. Behaviour identical.
package infra

import (
	"context"
	"fmt"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// QuotaUsageRepo counts user-owned rows per quota dimension.
type QuotaUsageRepo struct {
	pool *pgxpool.Pool
}

// NewQuotaUsageRepo wraps a pool.
func NewQuotaUsageRepo(pool *pgxpool.Pool) *QuotaUsageRepo {
	return &QuotaUsageRepo{pool: pool}
}

// CountSyncedNotes — non-archived hone_notes rows owned by user.
//
// hone_notes — actual table name (см. migrations/00014_hone_notes.sql).
// Раньше тут было ошибочное `notes` → каждый /quota request падал
// «relation "notes" does not exist». Free-tier фильтр (archived_at
// IS NULL) отсекает архивные ноты — они не считаются за quota.
func (r *QuotaUsageRepo) CountSyncedNotes(ctx context.Context, userID uuid.UUID) (int, error) {
	const q = `SELECT count(*) FROM hone_notes WHERE user_id = $1 AND archived_at IS NULL`
	var n int
	if err := r.pool.QueryRow(ctx, q, sharedpg.UUID(userID)).Scan(&n); err != nil {
		return 0, fmt.Errorf("subscription: count synced notes: %w", err)
	}
	return n, nil
}

// CountActiveSharedBoards — whiteboard rooms owned by user, visibility=shared,
// not yet expired.
func (r *QuotaUsageRepo) CountActiveSharedBoards(ctx context.Context, userID uuid.UUID) (int, error) {
	const q = `SELECT count(*) FROM whiteboard_rooms
	            WHERE owner_id = $1
	              AND visibility = 'shared'
	              AND expires_at > now()`
	var n int
	if err := r.pool.QueryRow(ctx, q, sharedpg.UUID(userID)).Scan(&n); err != nil {
		return 0, fmt.Errorf("subscription: count active shared boards: %w", err)
	}
	return n, nil
}

// CountActiveSharedRooms — editor rooms owned by user, visibility=shared,
// not yet expired.
func (r *QuotaUsageRepo) CountActiveSharedRooms(ctx context.Context, userID uuid.UUID) (int, error) {
	const q = `SELECT count(*) FROM editor_rooms
	            WHERE owner_id = $1
	              AND visibility = 'shared'
	              AND expires_at > now()`
	var n int
	if err := r.pool.QueryRow(ctx, q, sharedpg.UUID(userID)).Scan(&n); err != nil {
		return 0, fmt.Errorf("subscription: count active shared rooms: %w", err)
	}
	return n, nil
}

// CountAIThisMonth — STUB: ai_usage_log не развёрнут. Возвращаем 0 чтобы
// quota check не блокировал AI calls на Phase 1.
func (r *QuotaUsageRepo) CountAIThisMonth(_ context.Context, _ uuid.UUID) (int, error) {
	return 0, nil
}
