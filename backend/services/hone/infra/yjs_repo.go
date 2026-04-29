// yjs_repo.go — Phase C-6 generic Yjs CRDT persistence. SQL дословно
// перенесён из cmd/monolith/services/hone/yjs_persistence.go.
package infra

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/hone/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// YjsRepoPG — Postgres impl of domain.YjsRepo. Generic по yjsKind:
// одна repo обслуживает notes + whiteboards (+ будущие kind'ы).
type YjsRepoPG struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

// NewYjsRepo wraps pool + logger. log опционален.
func NewYjsRepo(pool *pgxpool.Pool, log *slog.Logger) *YjsRepoPG {
	if log == nil {
		log = slog.Default()
	}
	return &YjsRepoPG{pool: pool, log: log}
}

// OwnsParent — true если (userID, parentID) указывают на существующую
// строку в parent-таблице.
func (r *YjsRepoPG) OwnsParent(ctx context.Context, k domain.YjsKind, userID, parentID uuid.UUID) (bool, error) {
	var dummy int
	q := fmt.Sprintf(`SELECT 1 FROM %s WHERE id=$1 AND user_id=$2`, k.ParentTable)
	err := r.pool.QueryRow(ctx, q, parentID, userID).Scan(&dummy)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("hone.YjsRepoPG.OwnsParent(%s): %w", k.ParentTable, err)
	}
	return true, nil
}

// Append вставляет одну update-row. originDeviceID игнорируется: v2
// baseline дропнул колонку origin_device_id из note_yjs_updates +
// whiteboard_yjs_updates (дедуп идёт через monotonic seq на pull-side).
// Параметр оставлен в сигнатуре для обратной совместимости с app/UC,
// но в БД не пишется.
func (r *YjsRepoPG) Append(ctx context.Context, k domain.YjsKind, userID, parentID uuid.UUID, data []byte, _ *uuid.UUID) (domain.YjsAppendResult, error) {
	q := fmt.Sprintf(
		`INSERT INTO %s (%s, user_id, update_data)
		 VALUES ($1, $2, $3)
		 RETURNING seq, created_at`,
		k.UpdatesTable, k.ForeignKey,
	)
	var resp domain.YjsAppendResult
	if err := r.pool.QueryRow(ctx, q,
		parentID, userID, data,
	).Scan(&resp.Seq, &resp.CreatedAt); err != nil {
		return domain.YjsAppendResult{}, fmt.Errorf("hone.YjsRepoPG.Append: %w", err)
	}
	return resp, nil
}

// ListSince — updates с seq > since, ASC, до limit штук. v2 baseline
// дропнул origin_device_id, поле YjsUpdate.OriginDeviceID остаётся nil.
func (r *YjsRepoPG) ListSince(ctx context.Context, k domain.YjsKind, userID, parentID uuid.UUID, since int64, limit int) ([]domain.YjsUpdate, error) {
	q := fmt.Sprintf(
		`SELECT seq, update_data, created_at
		   FROM %s
		  WHERE %s=$1 AND user_id=$2 AND seq > $3
		  ORDER BY seq ASC
		  LIMIT $4`,
		k.UpdatesTable, k.ForeignKey,
	)
	rows, err := r.pool.Query(ctx, q, parentID, userID, since, limit)
	if err != nil {
		return nil, fmt.Errorf("hone.YjsRepoPG.ListSince: query: %w", err)
	}
	defer rows.Close()

	out := make([]domain.YjsUpdate, 0, 32)
	for rows.Next() {
		var u domain.YjsUpdate
		if err := rows.Scan(&u.Seq, &u.Data, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("hone.YjsRepoPG.ListSince: scan: %w", err)
		}
		out = append(out, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.YjsRepoPG.ListSince: rows: %w", err)
	}
	return out, nil
}

// Compact — TX: insert merged + delete все старые с seq < newSeq.
// originDeviceID игнорируется (см. Append).
func (r *YjsRepoPG) Compact(ctx context.Context, k domain.YjsKind, userID, parentID uuid.UUID, mergedData []byte, _ *uuid.UUID) (domain.YjsCompactResult, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.YjsCompactResult{}, fmt.Errorf("hone.YjsRepoPG.Compact: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	insertQ := fmt.Sprintf(
		`INSERT INTO %s (%s, user_id, update_data)
		 VALUES ($1, $2, $3)
		 RETURNING seq`,
		k.UpdatesTable, k.ForeignKey,
	)
	var newSeq int64
	if qErr := tx.QueryRow(ctx, insertQ,
		parentID, userID, mergedData,
	).Scan(&newSeq); qErr != nil {
		return domain.YjsCompactResult{}, fmt.Errorf("hone.YjsRepoPG.Compact: insert: %w", qErr)
	}

	deleteQ := fmt.Sprintf(
		`DELETE FROM %s WHERE %s=$1 AND user_id=$2 AND seq < $3`,
		k.UpdatesTable, k.ForeignKey,
	)
	cmd, err := tx.Exec(ctx, deleteQ, parentID, userID, newSeq)
	if err != nil {
		return domain.YjsCompactResult{}, fmt.Errorf("hone.YjsRepoPG.Compact: delete: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.YjsCompactResult{}, fmt.Errorf("hone.YjsRepoPG.Compact: commit: %w", err)
	}
	return domain.YjsCompactResult{Seq: newSeq, Removed: cmd.RowsAffected()}, nil
}

var _ domain.YjsRepo = (*YjsRepoPG)(nil)
