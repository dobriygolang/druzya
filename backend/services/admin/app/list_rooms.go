// list_rooms.go — Phase 12.5 /admin/rooms moderation reader.
//
// Surfaces standalone collab rooms (Path C low-key) for admin moderation:
// list by user/kind/status, abuse signals (если есть в payload),
// bulk-archive expired, top-creators (free-tier breaches).
//
// NB: bounded-context boundary — admin читает obe tables напрямую через
// Pool. Не импортирует services/rooms — это monolith-level reader.
package app

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminRoomsReader — postgres-backed reader.
type AdminRoomsReader struct {
	Pool *pgxpool.Pool
}

// AdminRoomRow — flat row для table view.
type AdminRoomRow struct {
	ID          uuid.UUID
	OwnerID     uuid.UUID
	OwnerLogin  string
	Kind        string  // code|whiteboard
	Title       string
	FreeTier    bool
	ExpiresAt   time.Time
	ArchivedAt  *time.Time
	CreatedAt   time.Time
	Status      string  // active|expired|archived
}

type AdminRoomsFilter struct {
	UserID *uuid.UUID
	Kind   string // ""|code|whiteboard
	Status string // ""|active|expired|archived
	Limit  int    // default 50
}

// List возвращает rows для admin table.
func (r *AdminRoomsReader) List(ctx context.Context, f AdminRoomsFilter) ([]AdminRoomRow, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	now := time.Now().UTC()

	// Union over editor_rooms + whiteboard_rooms. Чтобы не плодить два
	// query-path'а, используем UNION ALL с kind-литералом.
	q := `
SELECT * FROM (
  SELECT id, owner_id, 'code'::text AS kind, ''::text AS title,
         free_tier, expires_at, archived_at, created_at
  FROM editor_rooms
  UNION ALL
  SELECT id, owner_id, 'whiteboard'::text AS kind, COALESCE(title,'') AS title,
         free_tier, expires_at, archived_at, created_at
  FROM whiteboard_rooms
) AS rooms
WHERE 1=1
`
	args := []any{}
	argN := 0
	if f.UserID != nil {
		argN++
		q += fmt.Sprintf(" AND owner_id = $%d", argN)
		args = append(args, *f.UserID)
	}
	if f.Kind != "" {
		argN++
		q += fmt.Sprintf(" AND kind = $%d", argN)
		args = append(args, f.Kind)
	}
	switch f.Status {
	case "active":
		argN++
		q += fmt.Sprintf(" AND archived_at IS NULL AND expires_at > $%d", argN)
		args = append(args, now)
	case "expired":
		argN++
		q += fmt.Sprintf(" AND archived_at IS NULL AND expires_at <= $%d", argN)
		args = append(args, now)
	case "archived":
		q += " AND archived_at IS NOT NULL"
	}
	argN++
	q += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", argN)
	args = append(args, limit)

	rows, err := r.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin.AdminRoomsReader.List: %w", err)
	}
	defer rows.Close()

	var out []AdminRoomRow
	for rows.Next() {
		var row AdminRoomRow
		var archived *time.Time
		if err := rows.Scan(&row.ID, &row.OwnerID, &row.Kind, &row.Title,
			&row.FreeTier, &row.ExpiresAt, &archived, &row.CreatedAt); err != nil {
			return nil, fmt.Errorf("admin.AdminRoomsReader.List scan: %w", err)
		}
		row.ArchivedAt = archived
		switch {
		case archived != nil:
			row.Status = "archived"
		case row.ExpiresAt.After(now):
			row.Status = "active"
		default:
			row.Status = "expired"
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// TopCreators — top-N юзеров по active_count (free-tier breach signal).
type TopCreator struct {
	UserID      uuid.UUID
	ActiveCount int
	Tier        string
}

func (r *AdminRoomsReader) TopCreators(ctx context.Context, limit int) ([]TopCreator, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := r.Pool.Query(ctx, `
SELECT user_id, active_count, tier
FROM user_room_quota
ORDER BY active_count DESC
LIMIT $1
`, limit)
	if err != nil {
		return nil, fmt.Errorf("admin.AdminRoomsReader.TopCreators: %w", err)
	}
	defer rows.Close()
	var out []TopCreator
	for rows.Next() {
		var t TopCreator
		if err := rows.Scan(&t.UserID, &t.ActiveCount, &t.Tier); err != nil {
			return nil, fmt.Errorf("admin.AdminRoomsReader.TopCreators scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// BulkArchiveExpired — admin override чтобы archive expired non-archived rows
// батчем (cron делает это автоматически, но admin может force ahead).
func (r *AdminRoomsReader) BulkArchiveExpired(ctx context.Context) (int, error) {
	now := time.Now().UTC()
	tag1, err := r.Pool.Exec(ctx, `
UPDATE editor_rooms SET archived_at = $1
WHERE archived_at IS NULL AND expires_at < $1
`, now)
	if err != nil {
		return 0, fmt.Errorf("admin.BulkArchiveExpired editor: %w", err)
	}
	tag2, err := r.Pool.Exec(ctx, `
UPDATE whiteboard_rooms SET archived_at = $1
WHERE archived_at IS NULL AND expires_at < $1
`, now)
	if err != nil {
		return int(tag1.RowsAffected()), fmt.Errorf("admin.BulkArchiveExpired whiteboard: %w", err)
	}
	return int(tag1.RowsAffected()) + int(tag2.RowsAffected()), nil
}
