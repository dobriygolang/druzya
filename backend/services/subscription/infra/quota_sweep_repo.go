// quota_sweep_repo.go — implements domain.QuotaSweepRepo against pgx.
//
// Moved out of cmd/monolith so cmd/ stays a pure facade. The queries are
// unchanged; only the boundary moved.
package infra

import (
	"context"
	"fmt"

	"druz9/subscription/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

type QuotaSweepRepo struct {
	Pool *pgxpool.Pool
}

func NewQuotaSweepRepo(pool *pgxpool.Pool) *QuotaSweepRepo {
	return &QuotaSweepRepo{Pool: pool}
}

func (r *QuotaSweepRepo) DowngradeExpiredWhiteboards(ctx context.Context) (int64, error) {
	const q = `
        UPDATE whiteboard_rooms wr
           SET visibility = 'private'
         WHERE wr.visibility = 'shared'
           AND wr.expires_at < now()
           AND COALESCE((
               SELECT s.plan FROM subscriptions s WHERE s.user_id = wr.owner_id
           ), 'free') = 'free'`
	tag, err := r.Pool.Exec(ctx, q)
	if err != nil {
		return 0, fmt.Errorf("subscription.QuotaSweepRepo.DowngradeExpiredWhiteboards: %w", err)
	}
	return tag.RowsAffected(), nil
}

func (r *QuotaSweepRepo) DowngradeOverflowWhiteboards(ctx context.Context) (int64, error) {
	const q = `
        WITH ranked AS (
          SELECT wr.id,
                 ROW_NUMBER() OVER (PARTITION BY wr.owner_id ORDER BY wr.created_at DESC) AS rn
            FROM whiteboard_rooms wr
           WHERE wr.visibility = 'shared'
             AND wr.expires_at > now()
             AND COALESCE((
                 SELECT s.plan FROM subscriptions s WHERE s.user_id = wr.owner_id
             ), 'free') = 'free'
        )
        UPDATE whiteboard_rooms
           SET visibility = 'private'
         WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`
	tag, err := r.Pool.Exec(ctx, q)
	if err != nil {
		return 0, fmt.Errorf("subscription.QuotaSweepRepo.DowngradeOverflowWhiteboards: %w", err)
	}
	return tag.RowsAffected(), nil
}

func (r *QuotaSweepRepo) DowngradeExpiredEditorRooms(ctx context.Context) (int64, error) {
	const q = `
        UPDATE editor_rooms er
           SET visibility = 'private'
         WHERE er.visibility = 'shared'
           AND er.expires_at < now()
           AND COALESCE((
               SELECT s.plan FROM subscriptions s WHERE s.user_id = er.owner_id
           ), 'free') = 'free'`
	tag, err := r.Pool.Exec(ctx, q)
	if err != nil {
		return 0, fmt.Errorf("subscription.QuotaSweepRepo.DowngradeExpiredEditorRooms: %w", err)
	}
	return tag.RowsAffected(), nil
}

func (r *QuotaSweepRepo) DowngradeOverflowEditorRooms(ctx context.Context) (int64, error) {
	const q = `
        WITH ranked AS (
          SELECT er.id,
                 ROW_NUMBER() OVER (PARTITION BY er.owner_id ORDER BY er.created_at DESC) AS rn
            FROM editor_rooms er
           WHERE er.visibility = 'shared'
             AND er.expires_at > now()
             AND COALESCE((
                 SELECT s.plan FROM subscriptions s WHERE s.user_id = er.owner_id
             ), 'free') = 'free'
        )
        UPDATE editor_rooms
           SET visibility = 'private'
         WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`
	tag, err := r.Pool.Exec(ctx, q)
	if err != nil {
		return 0, fmt.Errorf("subscription.QuotaSweepRepo.DowngradeOverflowEditorRooms: %w", err)
	}
	return tag.RowsAffected(), nil
}

// ArchiveOverflowNotes — v2 семантика: hard-delete free-tier лишки.
// archive-концепции в schema_v2 нет; для quota-overflow free-tier'а
// удаляем самые старые по updated_at сверх freeTierLimit. Pro/Max
// ловит nil-fall-through через subscriptions.plan ≠ 'free' условие.
func (r *QuotaSweepRepo) ArchiveOverflowNotes(ctx context.Context, freeTierLimit int) (int64, error) {
	const q = `
        WITH ranked AS (
          SELECT n.id,
                 ROW_NUMBER() OVER (PARTITION BY n.user_id ORDER BY n.updated_at DESC) AS rn
            FROM hone_notes n
           WHERE COALESCE((
                 SELECT s.plan FROM subscriptions s WHERE s.user_id = n.user_id
             ), 'free') = 'free'
        )
        DELETE FROM hone_notes
         WHERE id IN (SELECT id FROM ranked WHERE rn > $1)`
	tag, err := r.Pool.Exec(ctx, q, freeTierLimit)
	if err != nil {
		return 0, fmt.Errorf("subscription.QuotaSweepRepo.ArchiveOverflowNotes: %w", err)
	}
	return tag.RowsAffected(), nil
}

// Compile-time guard.
var _ domain.QuotaSweepRepo = (*QuotaSweepRepo)(nil)
