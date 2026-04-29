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
	"errors"
	"fmt"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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

// CountSyncedNotes — все hone_notes rows юзера.
//
// v2: archived_at column dropped (hard-delete only) — все строки в
// таблице активные, фильтр не нужен.
func (r *QuotaUsageRepo) CountSyncedNotes(ctx context.Context, userID uuid.UUID) (int, error) {
	const q = `SELECT count(*) FROM hone_notes WHERE user_id = $1`
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

// CountAIThisMonth reads requests_used from copilot_quotas — the authoritative
// per-user AI call counter maintained by the copilot service. Returns 0 when
// the user has no quota row yet (first-time user who hasn't called the API).
func (r *QuotaUsageRepo) CountAIThisMonth(ctx context.Context, userID uuid.UUID) (int, error) {
	const q = `SELECT requests_used FROM copilot_quotas WHERE user_id = $1`
	var n int
	err := r.pool.QueryRow(ctx, q, sharedpg.UUID(userID)).Scan(&n)
	if err != nil {
		// ErrNoRows: user never called copilot — usage is 0.
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, fmt.Errorf("subscription: count AI this month: %w", err)
	}
	return n, nil
}
