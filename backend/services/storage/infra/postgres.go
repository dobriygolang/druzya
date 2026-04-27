// Package infra — Postgres-имплементация storage.domain.StorageRepo.
//
// SQL перенесён дословно из cmd/monolith/services/storage.go (Phase C).
// Изменения только косметические: pgx.ErrNoRows и ноль-affected-rows
// маппятся в domain.ErrNotFound, остальные ошибки оборачиваются через
// fmt.Errorf("storage.X: %w", err).
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/storage/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresRepo — единственная имплементация StorageRepo. Тонкая обёртка
// над *pgxpool.Pool: ни кэшей, ни state'а — TTL-cache живёт в quota-gate
// middleware'е выше (см. cmd/monolith/services/storage/storage.go).
type PostgresRepo struct {
	pool *pgxpool.Pool
}

// NewPostgresRepo wraps a pgx pool.
func NewPostgresRepo(pool *pgxpool.Pool) *PostgresRepo {
	return &PostgresRepo{pool: pool}
}

// GetQuota — SELECT users.storage_used_bytes / quota / tier по id.
func (r *PostgresRepo) GetQuota(ctx context.Context, userID uuid.UUID) (domain.Quota, error) {
	var q domain.Quota
	err := r.pool.QueryRow(ctx,
		`SELECT storage_used_bytes, storage_quota_bytes, storage_tier
		   FROM users WHERE id = $1`,
		userID,
	).Scan(&q.UsedBytes, &q.QuotaBytes, &q.Tier)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Quota{}, domain.ErrNotFound
		}
		return domain.Quota{}, fmt.Errorf("storage.PostgresRepo.GetQuota: %w", err)
	}
	return q, nil
}

// ArchiveOldestNotes — bulk UPDATE по N самым старым активным заметкам.
// Caller (use-case) уже clamp'ит count в [1..100].
func (r *PostgresRepo) ArchiveOldestNotes(ctx context.Context, userID uuid.UUID, count int) (int64, error) {
	cmd, err := r.pool.Exec(ctx,
		`UPDATE hone_notes
		    SET archived_at = now(), updated_at = now()
		  WHERE id IN (
		      SELECT id FROM hone_notes
		       WHERE user_id = $1 AND archived_at IS NULL
		       ORDER BY updated_at ASC
		       LIMIT $2
		  )`,
		userID, count,
	)
	if err != nil {
		return 0, fmt.Errorf("storage.PostgresRepo.ArchiveOldestNotes: %w", err)
	}
	return cmd.RowsAffected(), nil
}

// SetNoteArchived — single-id переключатель archived_at. Ноль-affected-rows
// (нет такой ноты или чужая) → ErrNotFound.
func (r *PostgresRepo) SetNoteArchived(ctx context.Context, userID, noteID uuid.UUID, archived bool) error {
	var stmt string
	if archived {
		stmt = `UPDATE hone_notes SET archived_at=now(), updated_at=now()
		         WHERE id=$1 AND user_id=$2`
	} else {
		stmt = `UPDATE hone_notes SET archived_at=NULL, updated_at=now()
		         WHERE id=$1 AND user_id=$2`
	}
	cmd, err := r.pool.Exec(ctx, stmt, noteID, userID)
	if err != nil {
		return fmt.Errorf("storage.PostgresRepo.SetNoteArchived: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// RecomputeAllUsage — пересчёт users.storage_used_bytes для ВСЕХ юзеров.
//
// SQL перенесён дословно. Архивированные ноты/whiteboards (archived_at IS
// NOT NULL) НЕ считаются — семантика usage = «то что тебе видно».
// coach_episodes — оценка через length(text)/octet_length(payload::text);
// не точный physical size, но достаточно для UX usage-bar'а.
func (r *PostgresRepo) RecomputeAllUsage(ctx context.Context) error {
	const q = `
WITH usage AS (
    SELECT u.id AS user_id,
           COALESCE(n.bytes,  0) +
           COALESCE(wb.bytes, 0) +
           COALESCE(ep.bytes, 0) AS total
    FROM users u
    LEFT JOIN (
        SELECT user_id, SUM(size_bytes)::bigint AS bytes
        FROM hone_notes
        WHERE archived_at IS NULL
        GROUP BY user_id
    ) n ON n.user_id = u.id
    LEFT JOIN (
        SELECT user_id, SUM(octet_length(state_json::text))::bigint AS bytes
        FROM hone_whiteboards
        WHERE archived_at IS NULL
        GROUP BY user_id
    ) wb ON wb.user_id = u.id
    LEFT JOIN (
        SELECT user_id,
               SUM(octet_length(summary) + octet_length(payload::text))::bigint AS bytes
        FROM coach_episodes
        GROUP BY user_id
    ) ep ON ep.user_id = u.id
)
UPDATE users
   SET storage_used_bytes    = usage.total,
       storage_recomputed_at = now()
  FROM usage
 WHERE users.id = usage.user_id`
	if _, err := r.pool.Exec(ctx, q); err != nil {
		return fmt.Errorf("storage.PostgresRepo.RecomputeAllUsage: %w", err)
	}
	return nil
}
