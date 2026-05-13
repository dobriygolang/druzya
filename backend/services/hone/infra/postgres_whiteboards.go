// Whiteboards repository — split out of postgres.go.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/hone/domain"
	sharedMw "druz9/shared/pkg/middleware"
	sharedpg "druz9/shared/pkg/pg"
	"druz9/shared/pkg/synctomb"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Whiteboards implements domain.WhiteboardRepo.
type Whiteboards struct {
	pool *pgxpool.Pool
}

// NewWhiteboards wraps a pool.
func NewWhiteboards(pool *pgxpool.Pool) *Whiteboards { return &Whiteboards{pool: pool} }

// Create inserts a board.
func (w *Whiteboards) Create(ctx context.Context, wb domain.Whiteboard) (domain.Whiteboard, error) {
	var (
		id        pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	err := w.pool.QueryRow(ctx,
		`INSERT INTO hone_whiteboards (user_id, title, state_json)
		 VALUES ($1, $2, $3)
		 RETURNING id, created_at, updated_at`,
		sharedpg.UUID(wb.UserID), wb.Title, wb.StateJSON,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.Whiteboard{}, fmt.Errorf("hone.Whiteboards.Create: %w", err)
	}
	wb.ID = sharedpg.UUIDFrom(id)
	wb.Version = 1
	wb.CreatedAt = createdAt
	wb.UpdatedAt = updatedAt
	return wb, nil
}

// Update enforces optimistic concurrency.
func (w *Whiteboards) Update(ctx context.Context, wb domain.Whiteboard, expectedVersion int) (domain.Whiteboard, error) {
	var (
		newVersion int32
		updatedAt  time.Time
		createdAt  time.Time
	)
	// WHERE clause: enforce version when expected > 0; otherwise ignore.
	err := w.pool.QueryRow(ctx,
		`UPDATE hone_whiteboards
		    SET title=$3, state_json=$4, version=version+1, updated_at=now()
		  WHERE id=$1 AND user_id=$2 AND ($5 = 0 OR version = $5)
		  RETURNING version, updated_at, created_at`,
		sharedpg.UUID(wb.ID), sharedpg.UUID(wb.UserID), wb.Title, wb.StateJSON, int32(expectedVersion),
	).Scan(&newVersion, &updatedAt, &createdAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Could be not-found OR stale version — distinguish cheaply.
			var exists bool
			_ = w.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM hone_whiteboards WHERE id=$1 AND user_id=$2)`,
				sharedpg.UUID(wb.ID), sharedpg.UUID(wb.UserID)).Scan(&exists)
			if exists {
				return domain.Whiteboard{}, domain.ErrStaleVersion
			}
			return domain.Whiteboard{}, domain.ErrNotFound
		}
		return domain.Whiteboard{}, fmt.Errorf("hone.Whiteboards.Update: %w", err)
	}
	wb.Version = int(newVersion)
	wb.UpdatedAt = updatedAt
	wb.CreatedAt = createdAt
	return wb, nil
}

// Get fetches one board.
func (w *Whiteboards) Get(ctx context.Context, userID, wbID uuid.UUID) (domain.Whiteboard, error) {
	var (
		title     string
		stateJSON []byte
		version   int32
		createdAt time.Time
		updatedAt time.Time
	)
	err := w.pool.QueryRow(ctx,
		`SELECT title, state_json, version, created_at, updated_at
		   FROM hone_whiteboards
		  WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(wbID), sharedpg.UUID(userID),
	).Scan(&title, &stateJSON, &version, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Whiteboard{}, domain.ErrNotFound
		}
		return domain.Whiteboard{}, fmt.Errorf("hone.Whiteboards.Get: %w", err)
	}
	return domain.Whiteboard{
		ID:        wbID,
		UserID:    userID,
		Title:     title,
		StateJSON: stateJSON,
		Version:   int(version),
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}, nil
}

// List returns summaries, newest updated first.
func (w *Whiteboards) List(ctx context.Context, userID uuid.UUID) ([]domain.WhiteboardSummary, error) {
	rows, err := w.pool.Query(ctx,
		// v2 baseline: archived_at column dropped (hard delete only).
		`SELECT id, title, updated_at
		   FROM hone_whiteboards
		  WHERE user_id=$1
		  ORDER BY updated_at DESC`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("hone.Whiteboards.List: %w", err)
	}
	defer rows.Close()
	out := make([]domain.WhiteboardSummary, 0, 16)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			updatedAt time.Time
		)
		if err := rows.Scan(&id, &title, &updatedAt); err != nil {
			return nil, fmt.Errorf("hone.Whiteboards.List: scan: %w", err)
		}
		out = append(out, domain.WhiteboardSummary{
			ID:        sharedpg.UUIDFrom(id),
			Title:     title,
			UpdatedAt: updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Whiteboards.List: rows: %w", err)
	}
	return out, nil
}

// Delete removes a whiteboard. Атомарно с DELETE пишет sync_tombstone
// (см. Notes.Delete для rationale).
func (w *Whiteboards) Delete(ctx context.Context, userID, wbID uuid.UUID) error {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("hone.Whiteboards.Delete: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	cmd, err := tx.Exec(ctx,
		`DELETE FROM hone_whiteboards WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(wbID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.Whiteboards.Delete: exec: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if err := synctomb.Write(ctx, tx, synctomb.TableHoneWhiteboards,
		userID, wbID, sharedMw.DeviceIDFromContext(ctx)); err != nil {
		return fmt.Errorf("hone.Whiteboards.Delete: tombstone: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("hone.Whiteboards.Delete: commit: %w", err)
	}
	return nil
}
