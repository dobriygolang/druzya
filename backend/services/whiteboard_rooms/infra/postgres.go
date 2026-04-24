// Package infra contains hand-rolled pgx adapters for whiteboard_rooms.
//
// MVP policy matches hone/: hand-rolled until the schema stabilises. The
// Yjs snapshot blob is stored as BYTEA (pgx handles []byte natively).
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/whiteboard_rooms/domain"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Rooms implements domain.RoomRepo.
type Rooms struct {
	pool *pgxpool.Pool
}

// NewRooms wraps a pool.
func NewRooms(pool *pgxpool.Pool) *Rooms { return &Rooms{pool: pool} }

// Create inserts a new whiteboard room.
func (r *Rooms) Create(ctx context.Context, in domain.Room) (domain.Room, error) {
	var (
		id        pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	err := r.pool.QueryRow(ctx,
		`INSERT INTO whiteboard_rooms (id, owner_id, title, expires_at)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, created_at, updated_at`,
		sharedpg.UUID(in.ID), sharedpg.UUID(in.OwnerID), in.Title,
		pgtype.Timestamptz{Time: in.ExpiresAt, Valid: !in.ExpiresAt.IsZero()},
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.Room{}, fmt.Errorf("whiteboard_rooms.Rooms.Create: %w", err)
	}
	out := in
	out.ID = sharedpg.UUIDFrom(id)
	out.CreatedAt = createdAt
	out.UpdatedAt = updatedAt
	return out, nil
}

// Get loads a room by id.
func (r *Rooms) Get(ctx context.Context, id uuid.UUID) (domain.Room, error) {
	var (
		rowID     pgtype.UUID
		ownerID   pgtype.UUID
		title     string
		snapshot  []byte
		expiresAt time.Time
		createdAt time.Time
		updatedAt time.Time
	)
	err := r.pool.QueryRow(ctx,
		`SELECT id, owner_id, title, snapshot, expires_at, created_at, updated_at
		   FROM whiteboard_rooms WHERE id=$1`,
		sharedpg.UUID(id),
	).Scan(&rowID, &ownerID, &title, &snapshot, &expiresAt, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Room{}, domain.ErrNotFound
		}
		return domain.Room{}, fmt.Errorf("whiteboard_rooms.Rooms.Get: %w", err)
	}
	return domain.Room{
		ID:        sharedpg.UUIDFrom(rowID),
		OwnerID:   sharedpg.UUIDFrom(ownerID),
		Title:     title,
		Snapshot:  snapshot,
		ExpiresAt: expiresAt,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}, nil
}

// ListByUser returns rooms the user participates in (owner or invited),
// ordered by updated_at DESC so the recently-active rooms float up.
func (r *Rooms) ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.Room, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT r.id, r.owner_id, r.title, r.snapshot, r.expires_at, r.created_at, r.updated_at
		   FROM whiteboard_rooms r
		   JOIN whiteboard_room_participants p ON p.room_id = r.id
		  WHERE p.user_id = $1
		  ORDER BY r.updated_at DESC
		  LIMIT 200`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("whiteboard_rooms.Rooms.ListByUser: %w", err)
	}
	defer rows.Close()
	var out []domain.Room
	for rows.Next() {
		var (
			rowID     pgtype.UUID
			ownerID   pgtype.UUID
			title     string
			snapshot  []byte
			expiresAt time.Time
			createdAt time.Time
			updatedAt time.Time
		)
		if err := rows.Scan(&rowID, &ownerID, &title, &snapshot, &expiresAt, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("whiteboard_rooms.Rooms.ListByUser: scan: %w", err)
		}
		out = append(out, domain.Room{
			ID:        sharedpg.UUIDFrom(rowID),
			OwnerID:   sharedpg.UUIDFrom(ownerID),
			Title:     title,
			Snapshot:  snapshot,
			ExpiresAt: expiresAt,
			CreatedAt: createdAt,
			UpdatedAt: updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("whiteboard_rooms.Rooms.ListByUser: rows: %w", err)
	}
	return out, nil
}

// UpdateSnapshot persists a merged Yjs state + bumps expires/updated.
func (r *Rooms) UpdateSnapshot(ctx context.Context, id uuid.UUID, snapshot []byte, expires time.Time) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE whiteboard_rooms
		    SET snapshot=$2, expires_at=$3, updated_at=now()
		  WHERE id=$1`,
		sharedpg.UUID(id), snapshot,
		pgtype.Timestamptz{Time: expires, Valid: true},
	)
	if err != nil {
		return fmt.Errorf("whiteboard_rooms.Rooms.UpdateSnapshot: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// Delete removes a room (cascades participants).
func (r *Rooms) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM whiteboard_rooms WHERE id=$1`,
		sharedpg.UUID(id),
	)
	if err != nil {
		return fmt.Errorf("whiteboard_rooms.Rooms.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// Participants implements domain.ParticipantRepo.
type Participants struct {
	pool *pgxpool.Pool
}

// NewParticipants wraps a pool.
func NewParticipants(pool *pgxpool.Pool) *Participants { return &Participants{pool: pool} }

// Add upserts a participant (ON CONFLICT DO NOTHING — idempotent re-joins).
func (p *Participants) Add(ctx context.Context, in domain.Participant) (domain.Participant, error) {
	var joinedAt time.Time
	err := p.pool.QueryRow(ctx,
		`INSERT INTO whiteboard_room_participants (room_id, user_id, joined_at)
		 VALUES ($1, $2, COALESCE(NULLIF($3, '0001-01-01 00:00:00+00'::timestamptz), now()))
		 ON CONFLICT (room_id, user_id) DO UPDATE SET joined_at = whiteboard_room_participants.joined_at
		 RETURNING joined_at`,
		sharedpg.UUID(in.RoomID), sharedpg.UUID(in.UserID),
		pgtype.Timestamptz{Time: in.JoinedAt, Valid: !in.JoinedAt.IsZero()},
	).Scan(&joinedAt)
	if err != nil {
		return domain.Participant{}, fmt.Errorf("whiteboard_rooms.Participants.Add: %w", err)
	}
	out := in
	out.JoinedAt = joinedAt
	return out, nil
}

// List returns participants with a username join for UI chips.
func (p *Participants) List(ctx context.Context, roomID uuid.UUID) ([]domain.ParticipantWithUsername, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT p.room_id, p.user_id, p.joined_at, COALESCE(u.username, '')
		   FROM whiteboard_room_participants p
		   LEFT JOIN users u ON u.id = p.user_id
		  WHERE p.room_id=$1
		  ORDER BY p.joined_at ASC`,
		sharedpg.UUID(roomID),
	)
	if err != nil {
		return nil, fmt.Errorf("whiteboard_rooms.Participants.List: %w", err)
	}
	defer rows.Close()
	var out []domain.ParticipantWithUsername
	for rows.Next() {
		var (
			rID      pgtype.UUID
			uID      pgtype.UUID
			joined   time.Time
			username string
		)
		if err := rows.Scan(&rID, &uID, &joined, &username); err != nil {
			return nil, fmt.Errorf("whiteboard_rooms.Participants.List: scan: %w", err)
		}
		out = append(out, domain.ParticipantWithUsername{
			Participant: domain.Participant{
				RoomID:   sharedpg.UUIDFrom(rID),
				UserID:   sharedpg.UUIDFrom(uID),
				JoinedAt: joined,
			},
			Username: username,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("whiteboard_rooms.Participants.List: rows: %w", err)
	}
	return out, nil
}

// Exists reports participant membership.
func (p *Participants) Exists(ctx context.Context, roomID, userID uuid.UUID) (bool, error) {
	var one int
	err := p.pool.QueryRow(ctx,
		`SELECT 1 FROM whiteboard_room_participants WHERE room_id=$1 AND user_id=$2`,
		sharedpg.UUID(roomID), sharedpg.UUID(userID),
	).Scan(&one)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("whiteboard_rooms.Participants.Exists: %w", err)
	}
	return true, nil
}

// Interface guards.
var (
	_ domain.RoomRepo        = (*Rooms)(nil)
	_ domain.ParticipantRepo = (*Participants)(nil)
)
