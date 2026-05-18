// memory_entries_postgres.go — user-facing read + soft-delete для
// coach_episodes.
//
// Reads coach_episodes WHERE deleted_at IS NULL with optional kind / since
// filter. Soft-delete stamps deleted_at = now() scoped to (id, user_id).
//
// Lives separately from memory_postgres.go чтобы не разрастаться: первый —
// AI-internal Append/Search/Recall; этот — user-facing transparency.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MemoryEntriesPostgres — pgx-backed MemoryEntryReader.
type MemoryEntriesPostgres struct{ pool *pgxpool.Pool }

// NewMemoryEntriesPostgres wires the adapter.
func NewMemoryEntriesPostgres(pool *pgxpool.Pool) *MemoryEntriesPostgres {
	return &MemoryEntriesPostgres{pool: pool}
}

// List returns paginated alive entries newest-first plus total row count.
//
// Filters:
//   - WHERE deleted_at IS NULL (always)
//   - WHERE kind = $kind (when filter.Kind != "")
//   - WHERE occurred_at >= $since (when filter.Since != nil)
func (r *MemoryEntriesPostgres) List(ctx context.Context, filter domain.MemoryEntryFilter) (domain.MemoryEntryPage, error) {
	args := []any{sharedpg.UUID(filter.UserID)}
	where := []string{"user_id = $1", "deleted_at IS NULL"}
	if filter.Kind != "" {
		args = append(args, string(filter.Kind))
		where = append(where, fmt.Sprintf("kind = $%d", len(args)))
	}
	if filter.Since != nil {
		args = append(args, *filter.Since)
		where = append(where, fmt.Sprintf("occurred_at >= $%d", len(args)))
	}
	whereSQL := whereClause(where)

	// Count first.
	var total int
	countSQL := "SELECT COUNT(*) FROM coach_episodes " + whereSQL
	if err := r.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return domain.MemoryEntryPage{}, fmt.Errorf("intelligence.MemoryEntriesPostgres.List count: %w", err)
	}
	if total == 0 {
		return domain.MemoryEntryPage{}, nil
	}

	// Append limit / offset.
	args = append(args, filter.Limit, filter.Offset)
	listSQL := fmt.Sprintf(`
		SELECT id, user_id, kind, summary, payload,
		       (SELECT name FROM embedding_models WHERE id = embedding_model_id),
		       embedded_at, occurred_at, created_at, edited_at
		  FROM coach_episodes
		  %s
		 ORDER BY occurred_at DESC
		 LIMIT $%d OFFSET $%d`, whereSQL, len(args)-1, len(args))

	rows, err := r.pool.Query(ctx, listSQL, args...)
	if err != nil {
		return domain.MemoryEntryPage{}, fmt.Errorf("intelligence.MemoryEntriesPostgres.List query: %w", err)
	}
	defer rows.Close()

	items := make([]domain.Episode, 0, filter.Limit)
	for rows.Next() {
		var (
			id, userID     pgtype.UUID
			kind           string
			summary        string
			payload        []byte
			embeddingModel pgtype.Text
			embeddedAt     pgtype.Timestamptz
			occurredAt     time.Time
			createdAt      time.Time
			editedAt       pgtype.Timestamptz
		)
		if err := rows.Scan(&id, &userID, &kind, &summary, &payload,
			&embeddingModel, &embeddedAt, &occurredAt, &createdAt, &editedAt); err != nil {
			return domain.MemoryEntryPage{}, fmt.Errorf("intelligence.MemoryEntriesPostgres.List scan: %w", err)
		}
		ep := domain.Episode{
			ID:         sharedpg.UUIDFrom(id),
			UserID:     sharedpg.UUIDFrom(userID),
			Kind:       domain.EpisodeKind(kind),
			Summary:    summary,
			Payload:    payload,
			OccurredAt: occurredAt,
			CreatedAt:  createdAt,
		}
		if embeddingModel.Valid {
			ep.EmbeddingModel = embeddingModel.String
		}
		if embeddedAt.Valid {
			t := embeddedAt.Time
			ep.EmbeddedAt = &t
		}
		if editedAt.Valid {
			t := editedAt.Time
			ep.EditedAt = &t
		}
		items = append(items, ep)
	}
	if err := rows.Err(); err != nil {
		return domain.MemoryEntryPage{}, fmt.Errorf("intelligence.MemoryEntriesPostgres.List rows: %w", err)
	}
	return domain.MemoryEntryPage{Items: items, Total: total}, nil
}

// SoftDelete stamps deleted_at = now() scoped to (id, user_id). ErrNotFound
// if no alive row matches.
func (r *MemoryEntriesPostgres) SoftDelete(ctx context.Context, userID, episodeID uuid.UUID) error {
	cmd, err := r.pool.Exec(ctx, `
		UPDATE coach_episodes
		   SET deleted_at = now()
		 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		sharedpg.UUID(episodeID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("intelligence.MemoryEntriesPostgres.SoftDelete: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// Edit обновляет summary + ставит edited_at = now(). Bonus: сбрасывает
// embedded_at и embedding_model_id чтобы embed_worker пересчитал вектор
// под новый текст (cosine similarity иначе будет against старого summary).
func (r *MemoryEntriesPostgres) Edit(ctx context.Context, userID, episodeID uuid.UUID, content string) (domain.Episode, error) {
	row := r.pool.QueryRow(ctx, `
		UPDATE coach_episodes
		   SET summary             = $3,
		       edited_at           = now(),
		       embedded_at         = NULL,
		       embedding_model_id  = NULL
		 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		 RETURNING id, user_id, kind, summary, payload,
		           occurred_at, created_at, edited_at`,
		sharedpg.UUID(episodeID), sharedpg.UUID(userID), content,
	)
	var (
		id, uid    pgtype.UUID
		kind       string
		summary    string
		payload    []byte
		occurredAt time.Time
		createdAt  time.Time
		editedAt   pgtype.Timestamptz
	)
	if err := row.Scan(&id, &uid, &kind, &summary, &payload, &occurredAt, &createdAt, &editedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Episode{}, domain.ErrNotFound
		}
		return domain.Episode{}, fmt.Errorf("intelligence.MemoryEntriesPostgres.Edit: %w", err)
	}
	ep := domain.Episode{
		ID:         sharedpg.UUIDFrom(id),
		UserID:     sharedpg.UUIDFrom(uid),
		Kind:       domain.EpisodeKind(kind),
		Summary:    summary,
		Payload:    payload,
		OccurredAt: occurredAt,
		CreatedAt:  createdAt,
	}
	if editedAt.Valid {
		t := editedAt.Time
		ep.EditedAt = &t
	}
	return ep, nil
}

func whereClause(parts []string) string {
	if len(parts) == 0 {
		return ""
	}
	out := "WHERE " + parts[0]
	for _, p := range parts[1:] {
		out += " AND " + p
	}
	return out
}

// Compile-time guard.
var _ domain.MemoryEntryReader = (*MemoryEntriesPostgres)(nil)
