// Package infra — Phase 9a postgres adapters.
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

// Rooms — unified read/write над editor_rooms + whiteboard_rooms.
type Rooms struct {
	pool *pgxpool.Pool
}

func NewRooms(p *pgxpool.Pool) *Rooms { return &Rooms{pool: p} }

func (r *Rooms) Create(ctx interface{}, room domain.Room) (domain.Room, error) {
	c := ctx.(context.Context)
	switch room.Kind {
	case domain.KindCode:
		// editor_rooms требует language NOT NULL — default "go" для standalone create.
		row := r.pool.QueryRow(c, `
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
		row := r.pool.QueryRow(c, `
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

func (r *Rooms) Get(ctx interface{}, kind domain.Kind, id uuid.UUID) (domain.Room, error) {
	c := ctx.(context.Context)
	out := domain.Room{ID: id, Kind: kind}
	var (
		title    *string
		archived *time.Time
	)
	switch kind {
	case domain.KindCode:
		err := r.pool.QueryRow(c, `
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
		err := r.pool.QueryRow(c, `
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

func (r *Rooms) ListMy(ctx interface{}, ownerID uuid.UUID, status domain.Status) ([]domain.Room, error) {
	c := ctx.(context.Context)
	now := time.Now().UTC()
	var out []domain.Room

	type query struct {
		sql  string
		kind domain.Kind
	}
	queries := []query{
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
		rows, err := r.pool.Query(c, q.sql, ownerID)
		if err != nil {
			return nil, fmt.Errorf("rooms.ListMy %s: %w", q.kind, err)
		}
		for rows.Next() {
			room := domain.Room{OwnerID: ownerID, Kind: q.kind}
			var archived *time.Time
			if q.kind == domain.KindCode {
				if err := rows.Scan(&room.ID, &room.ExpiresAt, &archived, &room.FreeTier, &room.Visibility, &room.CreatedAt); err != nil {
					rows.Close()
					return nil, fmt.Errorf("rooms.ListMy editor scan: %w", err)
				}
				room.UpdatedAt = room.CreatedAt
			} else {
				if err := rows.Scan(&room.ID, &room.Title, &room.ExpiresAt, &archived, &room.FreeTier, &room.Visibility, &room.CreatedAt, &room.UpdatedAt); err != nil {
					rows.Close()
					return nil, fmt.Errorf("rooms.ListMy whiteboard scan: %w", err)
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
			out = append(out, room)
		}
		rows.Close()
	}
	return out, nil
}

func (r *Rooms) ExtendExpiry(ctx interface{}, kind domain.Kind, id uuid.UUID, newExpiry time.Time) error {
	c := ctx.(context.Context)
	tbl, err := tableFor(kind)
	if err != nil {
		return err
	}
	if _, err := r.pool.Exec(c, `UPDATE `+tbl+` SET expires_at=$2 WHERE id=$1`, id, newExpiry); err != nil {
		return fmt.Errorf("rooms.ExtendExpiry: %w", err)
	}
	return nil
}

func (r *Rooms) Archive(ctx interface{}, kind domain.Kind, id uuid.UUID, at time.Time) error {
	c := ctx.(context.Context)
	tbl, err := tableFor(kind)
	if err != nil {
		return err
	}
	if _, err := r.pool.Exec(c, `UPDATE `+tbl+` SET archived_at=$2 WHERE id=$1 AND archived_at IS NULL`, id, at); err != nil {
		return fmt.Errorf("rooms.Archive: %w", err)
	}
	return nil
}

func (r *Rooms) Restore(ctx interface{}, kind domain.Kind, id uuid.UUID) error {
	c := ctx.(context.Context)
	tbl, err := tableFor(kind)
	if err != nil {
		return err
	}
	if _, err := r.pool.Exec(c, `UPDATE `+tbl+` SET archived_at=NULL WHERE id=$1`, id); err != nil {
		return fmt.Errorf("rooms.Restore: %w", err)
	}
	return nil
}

func (r *Rooms) ListExpiredCandidates(ctx interface{}, before time.Time, limit int) ([]domain.Room, error) {
	c := ctx.(context.Context)
	var out []domain.Room
	for _, kind := range []domain.Kind{domain.KindCode, domain.KindWhiteboard} {
		tbl, _ := tableFor(kind)
		rows, err := r.pool.Query(c,
			`SELECT id, owner_id, expires_at, free_tier
             FROM `+tbl+`
             WHERE archived_at IS NULL AND expires_at < $1
             ORDER BY expires_at ASC LIMIT $2`,
			before, limit)
		if err != nil {
			return nil, fmt.Errorf("rooms.ListExpiredCandidates %s: %w", kind, err)
		}
		for rows.Next() {
			r := domain.Room{Kind: kind}
			if err := rows.Scan(&r.ID, &r.OwnerID, &r.ExpiresAt, &r.FreeTier); err != nil {
				rows.Close()
				return nil, fmt.Errorf("rooms.ListExpiredCandidates scan: %w", err)
			}
			out = append(out, r)
		}
		rows.Close()
	}
	return out, nil
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

// ─── QuotaRepo ────────────────────────────────────────────────────────────

type Quota struct {
	pool *pgxpool.Pool
}

func NewQuota(p *pgxpool.Pool) *Quota { return &Quota{pool: p} }

func (q *Quota) Get(ctx interface{}, userID uuid.UUID) (domain.Quota, error) {
	c := ctx.(context.Context)
	out := domain.Quota{UserID: userID, Tier: "free"}
	err := q.pool.QueryRow(c, `
SELECT active_count, tier, period_start
FROM user_room_quota WHERE user_id=$1
`, userID).Scan(&out.ActiveCount, &out.Tier, &out.PeriodStart)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil // unknown user → defaults free/0
	}
	if err != nil {
		return out, fmt.Errorf("rooms.Quota.Get: %w", err)
	}
	return out, nil
}

func (q *Quota) Increment(ctx interface{}, userID uuid.UUID, tier string) error {
	c := ctx.(context.Context)
	if _, err := q.pool.Exec(c, `
INSERT INTO user_room_quota (user_id, active_count, tier)
VALUES ($1, 1, $2)
ON CONFLICT (user_id) DO UPDATE SET active_count = user_room_quota.active_count + 1
`, userID, tier); err != nil {
		return fmt.Errorf("rooms.Quota.Increment: %w", err)
	}
	return nil
}

func (q *Quota) Decrement(ctx interface{}, userID uuid.UUID) error {
	c := ctx.(context.Context)
	if _, err := q.pool.Exec(c, `
UPDATE user_room_quota SET active_count = GREATEST(active_count - 1, 0) WHERE user_id=$1
`, userID); err != nil {
		return fmt.Errorf("rooms.Quota.Decrement: %w", err)
	}
	return nil
}

func (q *Quota) Recompute(ctx interface{}, userID uuid.UUID, count int) error {
	c := ctx.(context.Context)
	if _, err := q.pool.Exec(c, `
INSERT INTO user_room_quota (user_id, active_count) VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE SET active_count = $2
`, userID, count); err != nil {
		return fmt.Errorf("rooms.Quota.Recompute: %w", err)
	}
	return nil
}
