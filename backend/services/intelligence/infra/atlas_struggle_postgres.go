// atlas_struggle_postgres.go — pgx adapter over user_atlas_struggle_marks
// (migration 00107). Cross-product handoff.
//
// Upsert uses ON CONFLICT (user_id, atlas_node_id) DO UPDATE — latest write
// wins. Producers across services (Cue, Hone, mock) emit these without
// coordination; the row reflects the latest evidence the user is stuck.
package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AtlasStrugglePostgres — pgx-backed AtlasStruggleRepo.
type AtlasStrugglePostgres struct{ pool *pgxpool.Pool }

// NewAtlasStrugglePostgres wires the adapter.
func NewAtlasStrugglePostgres(pool *pgxpool.Pool) *AtlasStrugglePostgres {
	return &AtlasStrugglePostgres{pool: pool}
}

// Upsert writes one row idempotently. Confidence/source/note/marked_at
// overwritten on conflict.
func (r *AtlasStrugglePostgres) Upsert(ctx context.Context, in domain.AtlasStruggleMark) error {
	markedAt := in.MarkedAt
	if markedAt.IsZero() {
		markedAt = time.Now().UTC()
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO user_atlas_struggle_marks
		    (user_id, atlas_node_id, source, confidence, note, marked_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (user_id, atlas_node_id) DO UPDATE
		    SET source     = EXCLUDED.source,
		        confidence = EXCLUDED.confidence,
		        note       = EXCLUDED.note,
		        marked_at  = EXCLUDED.marked_at`,
		sharedpg.UUID(in.UserID), in.AtlasNodeID, string(in.Source),
		in.Confidence, in.Note, markedAt,
	)
	if err != nil {
		return fmt.Errorf("intelligence.AtlasStrugglePostgres.Upsert: %w", err)
	}
	return nil
}

// ListByUser returns marks newest-first within windowDays.
func (r *AtlasStrugglePostgres) ListByUser(ctx context.Context, userID uuid.UUID, windowDays int) ([]domain.AtlasStruggleMark, error) {
	if windowDays <= 0 {
		windowDays = 30
	}
	if windowDays > 365 {
		windowDays = 365
	}
	rows, err := r.pool.Query(ctx, `
		SELECT atlas_node_id, source, confidence, note, marked_at
		  FROM user_atlas_struggle_marks
		 WHERE user_id = $1
		   AND marked_at >= now() - ($2 || ' days')::interval
		 ORDER BY marked_at DESC
		 LIMIT 500`,
		sharedpg.UUID(userID), fmt.Sprintf("%d", windowDays),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.AtlasStrugglePostgres.ListByUser: %w", err)
	}
	defer rows.Close()

	out := make([]domain.AtlasStruggleMark, 0, 32)
	for rows.Next() {
		var (
			nodeID     string
			source     string
			confidence float64
			note       string
			markedAt   time.Time
		)
		if err := rows.Scan(&nodeID, &source, &confidence, &note, &markedAt); err != nil {
			return nil, fmt.Errorf("intelligence.AtlasStrugglePostgres.ListByUser scan: %w", err)
		}
		out = append(out, domain.AtlasStruggleMark{
			UserID:      userID,
			AtlasNodeID: nodeID,
			Source:      domain.AtlasStruggleSource(source),
			Confidence:  confidence,
			Note:        note,
			MarkedAt:    markedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.AtlasStrugglePostgres.ListByUser rows: %w", err)
	}
	return out, nil
}

// Clear deletes one mark. Idempotent — missing row is not an error.
func (r *AtlasStrugglePostgres) Clear(ctx context.Context, userID uuid.UUID, atlasNodeID string) error {
	_, err := r.pool.Exec(ctx, `
		DELETE FROM user_atlas_struggle_marks
		 WHERE user_id = $1 AND atlas_node_id = $2`,
		sharedpg.UUID(userID), atlasNodeID,
	)
	if err != nil {
		return fmt.Errorf("intelligence.AtlasStrugglePostgres.Clear: %w", err)
	}
	return nil
}

// Compile-time guard.
var _ domain.AtlasStruggleRepo = (*AtlasStrugglePostgres)(nil)
