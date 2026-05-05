package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/intelligence/app"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ResourceLogPostgres — write-side для user_resource_log (миграция 00055).
// Read-side — ResourceEngagementReader в cross_readers.go.
type ResourceLogPostgres struct{ pool *pgxpool.Pool }

func NewResourceLogPostgres(pool *pgxpool.Pool) *ResourceLogPostgres {
	return &ResourceLogPostgres{pool: pool}
}

// Insert пишет event в user_resource_log. Caller передаёт entry без ID
// и (опционально) с OccurredAt; репо генерирует ID/now() при пустых.
func (r *ResourceLogPostgres) Insert(ctx context.Context, in app.ResourceLogEntry) (app.ResourceLogEntry, error) {
	var (
		atlasNode any = nil
		noteID    any = nil
		refl      any = nil
	)
	if in.AtlasNodeID != "" {
		atlasNode = in.AtlasNodeID
	}
	if in.ReflectionNoteID != nil {
		noteID = sharedpg.UUID(*in.ReflectionNoteID)
	}
	if in.ReflectionText != "" {
		refl = in.ReflectionText
	}
	occurredAt := in.OccurredAt
	if occurredAt.IsZero() {
		occurredAt = time.Now()
	}

	row := r.pool.QueryRow(ctx,
		`INSERT INTO user_resource_log
		   (user_id, resource_url, atlas_node_id, kind, occurred_at,
		    reflection_text, reflection_note_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, user_id, resource_url, COALESCE(atlas_node_id, ''),
		           kind, occurred_at, COALESCE(reflection_text, ''), reflection_note_id`,
		sharedpg.UUID(in.UserID), in.ResourceURL, atlasNode, in.Kind, occurredAt,
		refl, noteID,
	)
	var (
		id, userID                pgtype.UUID
		url, node, kind, reflText string
		occ                       time.Time
		rNoteID                   pgtype.UUID
	)
	if err := row.Scan(&id, &userID, &url, &node, &kind, &occ, &reflText, &rNoteID); err != nil {
		return app.ResourceLogEntry{}, fmt.Errorf("intelligence.ResourceLogPostgres.Insert: %w", err)
	}
	out := app.ResourceLogEntry{
		ID:             sharedpg.UUIDFrom(id),
		UserID:         sharedpg.UUIDFrom(userID),
		ResourceURL:    url,
		AtlasNodeID:    node,
		Kind:           kind,
		OccurredAt:     occ,
		ReflectionText: reflText,
	}
	if rNoteID.Valid {
		v := uuid.UUID(rNoteID.Bytes)
		out.ReflectionNoteID = &v
	}
	return out, nil
}

// Compile-time guard.
var _ app.ResourceLogRepo = (*ResourceLogPostgres)(nil)
