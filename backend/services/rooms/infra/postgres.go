// Package infra wires the room repositories to postgres.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/rooms/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Rooms is a unified read/write repo over editor_rooms + whiteboard_rooms.
type Rooms struct {
	pool *pgxpool.Pool
}

func NewRooms(p *pgxpool.Pool) *Rooms { return &Rooms{pool: p} }

func (r *Rooms) Create(ctx context.Context, room domain.Room) (domain.Room, error) {
	switch room.Kind {
	case domain.KindCode:
		// editor_rooms.language is NOT NULL, so standalone code rooms default
		// to "go" until the UI exposes a language picker.
		row := r.pool.QueryRow(ctx, `
INSERT INTO editor_rooms (owner_id, type, language, expires_at, visibility, free_tier)
VALUES ($1, 'practice', 'go', $2, $3, $4)
RETURNING id, created_at
`, room.OwnerID, room.ExpiresAt, room.Visibility, room.FreeTier)
		if err := row.Scan(&room.ID, &room.CreatedAt); err != nil {
			return room, fmt.Errorf("rooms.Create editor: %w", err)
		}
		room.UpdatedAt = room.CreatedAt
		return room, nil
	case domain.KindWhiteboard:
		row := r.pool.QueryRow(ctx, `
INSERT INTO whiteboard_rooms (owner_id, title, expires_at, visibility, free_tier)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, created_at, updated_at
`, room.OwnerID, room.Title, room.ExpiresAt, room.Visibility, room.FreeTier)
		if err := row.Scan(&room.ID, &room.CreatedAt, &room.UpdatedAt); err != nil {
			return room, fmt.Errorf("rooms.Create whiteboard: %w", err)
		}
		return room, nil
	}
	return room, domain.ErrInvalidKind
}

func (r *Rooms) Get(ctx context.Context, kind domain.Kind, id uuid.UUID) (domain.Room, error) {
	out := domain.Room{ID: id, Kind: kind}
	var (
		title    *string
		archived *time.Time
	)
	switch kind {
	case domain.KindCode:
		err := r.pool.QueryRow(ctx, `
SELECT owner_id, expires_at, archived_at, free_tier, visibility, created_at
FROM editor_rooms WHERE id=$1
`, id).Scan(&out.OwnerID, &out.ExpiresAt, &archived, &out.FreeTier, &out.Visibility, &out.CreatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return out, domain.ErrNotFound
		}
		if err != nil {
			return out, fmt.Errorf("rooms.Get editor: %w", err)
		}
		out.UpdatedAt = out.CreatedAt
	case domain.KindWhiteboard:
		err := r.pool.QueryRow(ctx, `
SELECT owner_id, title, expires_at, archived_at, free_tier, visibility, created_at, updated_at
FROM whiteboard_rooms WHERE id=$1
`, id).Scan(&out.OwnerID, &title, &out.ExpiresAt, &archived, &out.FreeTier, &out.Visibility, &out.CreatedAt, &out.UpdatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return out, domain.ErrNotFound
		}
		if err != nil {
			return out, fmt.Errorf("rooms.Get whiteboard: %w", err)
		}
		if title != nil {
			out.Title = *title
		}
	default:
		return out, domain.ErrInvalidKind
	}
	out.ArchivedAt = archived
	return out, nil
}

func (r *Rooms) ListMy(ctx context.Context, ownerID uuid.UUID, status domain.Status) ([]domain.Room, error) {
	now := time.Now().UTC()
	var out []domain.Room

	queries := []struct {
		sql  string
		kind domain.Kind
	}{
		{
			sql: `
SELECT id, expires_at, archived_at, free_tier, visibility, created_at
FROM editor_rooms WHERE owner_id=$1
`,
			kind: domain.KindCode,
		},
		{
			sql: `
SELECT id, COALESCE(title,''), expires_at, archived_at, free_tier, visibility, created_at, updated_at
FROM whiteboard_rooms WHERE owner_id=$1
`,
			kind: domain.KindWhiteboard,
		},
	}
	for _, q := range queries {
		if err := r.collectRoomsForKind(ctx, q.sql, q.kind, ownerID, now, status, &out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// collectRoomsForKind runs one per-kind query and appends matching rooms to
// *out. Pulled out so rows.Close fires via defer on every exit path, including
// the rows.Err() check that the prior inline version silently skipped.
func (r *Rooms) collectRoomsForKind(ctx context.Context, sql string, kind domain.Kind, ownerID uuid.UUID, now time.Time, status domain.Status, out *[]domain.Room) error {
	rows, err := r.pool.Query(ctx, sql, ownerID)
	if err != nil {
		return fmt.Errorf("rooms.ListMy %s: %w", kind, err)
	}
	defer rows.Close()
	for rows.Next() {
		room := domain.Room{OwnerID: ownerID, Kind: kind}
		var archived *time.Time
		if kind == domain.KindCode {
			if err := rows.Scan(&room.ID, &room.ExpiresAt, &archived, &room.FreeTier, &room.Visibility, &room.CreatedAt); err != nil {
				return fmt.Errorf("rooms.ListMy editor scan: %w", err)
			}
			room.UpdatedAt = room.CreatedAt
		} else {
			if err := rows.Scan(&room.ID, &room.Title, &room.ExpiresAt, &archived, &room.FreeTier, &room.Visibility, &room.CreatedAt, &room.UpdatedAt); err != nil {
				return fmt.Errorf("rooms.ListMy whiteboard scan: %w", err)
			}
		}
		room.ArchivedAt = archived
		active := archived == nil && room.ExpiresAt.After(now)
		switch status {
		case domain.StatusActive:
			if !active {
				continue
			}
		case domain.StatusPast:
			if active {
				continue
			}
		case domain.StatusAll:
			// no filter
		}
		*out = append(*out, room)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("rooms.ListMy %s rows: %w", kind, err)
	}
	return nil
}

func (r *Rooms) ExtendExpiry(ctx context.Context, kind domain.Kind, id uuid.UUID, newExpiry time.Time) error {
	tbl, err := tableFor(kind)
	if err != nil {
		return err
	}
	if _, err := r.pool.Exec(ctx, `UPDATE `+tbl+` SET expires_at=$2 WHERE id=$1`, id, newExpiry); err != nil {
		return fmt.Errorf("rooms.ExtendExpiry: %w", err)
	}
	return nil
}

func (r *Rooms) Archive(ctx context.Context, kind domain.Kind, id uuid.UUID, at time.Time) error {
	tbl, err := tableFor(kind)
	if err != nil {
		return err
	}
	if _, err := r.pool.Exec(ctx, `UPDATE `+tbl+` SET archived_at=$2 WHERE id=$1 AND archived_at IS NULL`, id, at); err != nil {
		return fmt.Errorf("rooms.Archive: %w", err)
	}
	return nil
}

func (r *Rooms) Restore(ctx context.Context, kind domain.Kind, id uuid.UUID) error {
	tbl, err := tableFor(kind)
	if err != nil {
		return err
	}
	if _, err := r.pool.Exec(ctx, `UPDATE `+tbl+` SET archived_at=NULL WHERE id=$1`, id); err != nil {
		return fmt.Errorf("rooms.Restore: %w", err)
	}
	return nil
}

func (r *Rooms) ListExpiredCandidates(ctx context.Context, before time.Time, limit int) ([]domain.Room, error) {
	var out []domain.Room
	for _, kind := range []domain.Kind{domain.KindCode, domain.KindWhiteboard} {
		tbl, _ := tableFor(kind)
		if err := r.collectExpiredForKind(ctx, tbl, kind, before, limit, &out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (r *Rooms) collectExpiredForKind(ctx context.Context, tbl string, kind domain.Kind, before time.Time, limit int, out *[]domain.Room) error {
	rows, err := r.pool.Query(ctx,
		`SELECT id, owner_id, expires_at, free_tier
		 FROM `+tbl+`
		 WHERE archived_at IS NULL AND expires_at < $1
		 ORDER BY expires_at ASC LIMIT $2`,
		before, limit)
	if err != nil {
		return fmt.Errorf("rooms.ListExpiredCandidates %s: %w", kind, err)
	}
	defer rows.Close()
	for rows.Next() {
		room := domain.Room{Kind: kind}
		if err := rows.Scan(&room.ID, &room.OwnerID, &room.ExpiresAt, &room.FreeTier); err != nil {
			return fmt.Errorf("rooms.ListExpiredCandidates scan: %w", err)
		}
		*out = append(*out, room)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("rooms.ListExpiredCandidates %s rows: %w", kind, err)
	}
	return nil
}

func tableFor(k domain.Kind) (string, error) {
	switch k {
	case domain.KindCode:
		return "editor_rooms", nil
	case domain.KindWhiteboard:
		return "whiteboard_rooms", nil
	}
	return "", domain.ErrInvalidKind
}

type Quota struct {
	pool *pgxpool.Pool
}

func NewQuota(p *pgxpool.Pool) *Quota { return &Quota{pool: p} }

func (q *Quota) Get(ctx context.Context, userID uuid.UUID) (domain.Quota, error) {
	out := domain.Quota{UserID: userID, Tier: "free"}
	err := q.pool.QueryRow(ctx, `
SELECT active_count, tier, period_start
FROM user_room_quota WHERE user_id=$1
`, userID).Scan(&out.ActiveCount, &out.Tier, &out.PeriodStart)
	if errors.Is(err, pgx.ErrNoRows) {
		// Unknown user defaults to free/0; no row is implicit "fresh account".
		return out, nil
	}
	if err != nil {
		return out, fmt.Errorf("rooms.Quota.Get: %w", err)
	}
	return out, nil
}

func (q *Quota) Increment(ctx context.Context, userID uuid.UUID, tier string) error {
	if _, err := q.pool.Exec(ctx, `
INSERT INTO user_room_quota (user_id, active_count, tier)
VALUES ($1, 1, $2)
ON CONFLICT (user_id) DO UPDATE SET active_count = user_room_quota.active_count + 1
`, userID, tier); err != nil {
		return fmt.Errorf("rooms.Quota.Increment: %w", err)
	}
	return nil
}

func (q *Quota) Decrement(ctx context.Context, userID uuid.UUID) error {
	if _, err := q.pool.Exec(ctx, `
UPDATE user_room_quota SET active_count = GREATEST(active_count - 1, 0) WHERE user_id=$1
`, userID); err != nil {
		return fmt.Errorf("rooms.Quota.Decrement: %w", err)
	}
	return nil
}

func (q *Quota) Recompute(ctx context.Context, userID uuid.UUID, count int) error {
	if _, err := q.pool.Exec(ctx, `
INSERT INTO user_room_quota (user_id, active_count) VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE SET active_count = $2
`, userID, count); err != nil {
		return fmt.Errorf("rooms.Quota.Recompute: %w", err)
	}
	return nil
}
