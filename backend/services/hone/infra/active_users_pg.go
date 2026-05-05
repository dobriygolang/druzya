// active_users_pg.go — implementation of app.ActiveUsersReader.
//
// Coach generator needs "users active in the last N days". The signal is
// fuzzy by design: we union two cheap sources kept up-to-date by other
// services (notify writes tg_user_link.last_seen_at, focus sessions are
// continuous activity), so a single SQL UNION gives us a stable
// approximation without a dedicated last_seen column on users.
package infra

import (
	"context"
	"fmt"
	"time"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ActiveUsersReader implements app.ActiveUsersReader.
type ActiveUsersReader struct {
	pool *pgxpool.Pool
}

// NewActiveUsersReader wires the reader.
func NewActiveUsersReader(pool *pgxpool.Pool) *ActiveUsersReader {
	return &ActiveUsersReader{pool: pool}
}

// ListActive returns user_ids that have produced at least one activity
// signal since `since`. Limit caps the row count so the coach generator
// stays bounded per sweep.
func (r *ActiveUsersReader) ListActive(ctx context.Context, since time.Time, limit int) ([]uuid.UUID, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx, `
        SELECT DISTINCT user_id FROM (
            SELECT user_id FROM tg_user_link
              WHERE last_seen_at >= $1
            UNION
            SELECT user_id FROM hone_focus_sessions
              WHERE started_at >= $1
        ) AS active
        LIMIT $2`,
		pgtype.Timestamptz{Time: since, Valid: true}, int32(limit))
	if err != nil {
		return nil, fmt.Errorf("hone.ActiveUsersReader.ListActive: %w", err)
	}
	defer rows.Close()
	out := make([]uuid.UUID, 0, 16)
	for rows.Next() {
		var id pgtype.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("hone.ActiveUsersReader.ListActive: scan: %w", err)
		}
		out = append(out, sharedpg.UUIDFrom(id))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.ActiveUsersReader.ListActive: rows: %w", err)
	}
	return out, nil
}
