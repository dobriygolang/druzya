// Package infra contains Postgres adapters and the MinIO replay uploader
// stub for the editor domain.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/editor/domain"
	editordb "druz9/editor/infra/db"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Rooms is the persistence adapter for editor_rooms.
type Rooms struct {
	pool *pgxpool.Pool
	q    *editordb.Queries
}

// NewRooms wraps a pool.
func NewRooms(pool *pgxpool.Pool) *Rooms {
	return &Rooms{pool: pool, q: editordb.New(pool)}
}

// Create inserts a new room.
func (r *Rooms) Create(ctx context.Context, in domain.Room) (domain.Room, error) {
	params := editordb.CreateRoomParams{
		OwnerID:   pgUUID(in.OwnerID),
		Type:      in.Type.String(),
		Language:  in.Language.String(),
		IsFrozen:  in.IsFrozen,
		ExpiresAt: pgtype.Timestamptz{Time: in.ExpiresAt, Valid: !in.ExpiresAt.IsZero()},
	}
	if in.TaskID != nil {
		params.TaskID = pgUUID(*in.TaskID)
	}
	row, err := r.q.CreateRoom(ctx, params)
	if err != nil {
		return domain.Room{}, fmt.Errorf("editor.Rooms.Create: %w", err)
	}
	return roomFromRow(row), nil
}

// Get loads a room by id.
func (r *Rooms) Get(ctx context.Context, id uuid.UUID) (domain.Room, error) {
	row, err := r.q.GetRoom(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Room{}, fmt.Errorf("editor.Rooms.Get: %w", domain.ErrNotFound)
		}
		return domain.Room{}, fmt.Errorf("editor.Rooms.Get: %w", err)
	}
	return roomFromRow(row), nil
}

// UpdateFreeze sets is_frozen.
func (r *Rooms) UpdateFreeze(ctx context.Context, id uuid.UUID, frozen bool) (domain.Room, error) {
	row, err := r.q.UpdateRoomFreeze(ctx, editordb.UpdateRoomFreezeParams{
		ID:       pgUUID(id),
		IsFrozen: frozen,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Room{}, fmt.Errorf("editor.Rooms.UpdateFreeze: %w", domain.ErrNotFound)
		}
		return domain.Room{}, fmt.Errorf("editor.Rooms.UpdateFreeze: %w", err)
	}
	return roomFromRow(row), nil
}

// ExtendExpires bumps the room's expires_at timestamp.
func (r *Rooms) ExtendExpires(ctx context.Context, id uuid.UUID, newExpires time.Time) error {
	affected, err := r.q.ExtendRoomExpires(ctx, editordb.ExtendRoomExpiresParams{
		ID:        pgUUID(id),
		ExpiresAt: pgtype.Timestamptz{Time: newExpires, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("editor.Rooms.ExtendExpires: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("editor.Rooms.ExtendExpires: %w", domain.ErrNotFound)
	}
	return nil
}

// Participants is the persistence adapter for editor_participants.
type Participants struct {
	q *editordb.Queries
}

// NewParticipants wraps a pool.
func NewParticipants(pool *pgxpool.Pool) *Participants {
	return &Participants{q: editordb.New(pool)}
}

// Add inserts or upserts (role changes) a participant row.
func (p *Participants) Add(ctx context.Context, in domain.Participant) (domain.Participant, error) {
	if !in.Role.IsValid() {
		return domain.Participant{}, fmt.Errorf("editor.Participants.Add: invalid role %q", in.Role)
	}
	row, err := p.q.AddParticipant(ctx, editordb.AddParticipantParams{
		RoomID: pgUUID(in.RoomID),
		UserID: pgUUID(in.UserID),
		Role:   in.Role.String(),
	})
	if err != nil {
		return domain.Participant{}, fmt.Errorf("editor.Participants.Add: %w", err)
	}
	return participantFromRow(row), nil
}

// List returns all participants of a room.
func (p *Participants) List(ctx context.Context, roomID uuid.UUID) ([]domain.Participant, error) {
	rows, err := p.q.ListParticipants(ctx, pgUUID(roomID))
	if err != nil {
		return nil, fmt.Errorf("editor.Participants.List: %w", err)
	}
	out := make([]domain.Participant, 0, len(rows))
	for _, r := range rows {
		out = append(out, participantFromRow(r))
	}
	return out, nil
}

// GetRole returns the role of a participant or ErrNotFound.
func (p *Participants) GetRole(ctx context.Context, roomID, userID uuid.UUID) (enums.EditorRole, error) {
	role, err := p.q.GetParticipantRole(ctx, editordb.GetParticipantRoleParams{
		RoomID: pgUUID(roomID),
		UserID: pgUUID(userID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("editor.Participants.GetRole: %w", domain.ErrNotFound)
		}
		return "", fmt.Errorf("editor.Participants.GetRole: %w", err)
	}
	r := enums.EditorRole(role)
	if !r.IsValid() {
		return "", fmt.Errorf("editor.Participants.GetRole: invalid role %q", role)
	}
	return r, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Conversion helpers
// ─────────────────────────────────────────────────────────────────────────

func roomFromRow(r editordb.EditorRoom) domain.Room {
	out := domain.Room{
		ID:        fromPgUUID(r.ID),
		OwnerID:   fromPgUUID(r.OwnerID),
		Type:      domain.RoomType(r.Type),
		Language:  enums.Language(r.Language),
		IsFrozen:  r.IsFrozen,
		ExpiresAt: r.ExpiresAt.Time,
		CreatedAt: r.CreatedAt.Time,
	}
	if r.TaskID.Valid {
		t := fromPgUUID(r.TaskID)
		out.TaskID = &t
	}
	return out
}

func participantFromRow(r editordb.EditorParticipant) domain.Participant {
	return domain.Participant{
		RoomID:   fromPgUUID(r.RoomID),
		UserID:   fromPgUUID(r.UserID),
		Role:     enums.EditorRole(r.Role),
		JoinedAt: r.JoinedAt.Time,
	}
}

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

// Interface guards.
var (
	_ domain.RoomRepo        = (*Rooms)(nil)
	_ domain.ParticipantRepo = (*Participants)(nil)
)
