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

	sharedpg "druz9/shared/pkg/pg"

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

// Create inserts a new room. Visibility defaults to 'shared' (см. миграцию
// 00042) — здесь явно не передаём, БД сама проставит DEFAULT.
func (r *Rooms) Create(ctx context.Context, in domain.Room) (domain.Room, error) {
	params := editordb.CreateRoomParams{
		OwnerID:   sharedpg.UUID(in.OwnerID),
		Type:      in.Type.String(),
		Language:  in.Language.String(),
		IsFrozen:  in.IsFrozen,
		ExpiresAt: pgtype.Timestamptz{Time: in.ExpiresAt, Valid: !in.ExpiresAt.IsZero()},
	}
	if in.TaskID != nil {
		params.TaskID = sharedpg.UUID(*in.TaskID)
	}
	row, err := r.q.CreateRoom(ctx, params)
	if err != nil {
		return domain.Room{}, fmt.Errorf("editor.Rooms.Create: %w", err)
	}
	return roomFromCreateRow(row), nil
}

// Get loads a room by id.
func (r *Rooms) Get(ctx context.Context, id uuid.UUID) (domain.Room, error) {
	row, err := r.q.GetRoom(ctx, sharedpg.UUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Room{}, fmt.Errorf("editor.Rooms.Get: %w", domain.ErrNotFound)
		}
		return domain.Room{}, fmt.Errorf("editor.Rooms.Get: %w", err)
	}
	return roomFromGetRow(row), nil
}

// SetVisibility flips visibility на editor_rooms row. Owner-check делается
// на уровне handler'а (не здесь); этот метод чисто write. Sqlc-generated
// query SetRoomVisibility (см. queries/editor.sql).
func (r *Rooms) SetVisibility(ctx context.Context, id uuid.UUID, v domain.Visibility) error {
	if !v.IsValid() {
		return fmt.Errorf("editor.Rooms.SetVisibility: invalid visibility %q", v)
	}
	affected, err := r.q.SetRoomVisibility(ctx, editordb.SetRoomVisibilityParams{
		ID:         sharedpg.UUID(id),
		Visibility: string(v),
	})
	if err != nil {
		return fmt.Errorf("editor.Rooms.SetVisibility: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("editor.Rooms.SetVisibility: %w", domain.ErrNotFound)
	}
	return nil
}

// UpdateFreeze sets is_frozen.
func (r *Rooms) UpdateFreeze(ctx context.Context, id uuid.UUID, frozen bool) (domain.Room, error) {
	row, err := r.q.UpdateRoomFreeze(ctx, editordb.UpdateRoomFreezeParams{
		ID:       sharedpg.UUID(id),
		IsFrozen: frozen,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Room{}, fmt.Errorf("editor.Rooms.UpdateFreeze: %w", domain.ErrNotFound)
		}
		return domain.Room{}, fmt.Errorf("editor.Rooms.UpdateFreeze: %w", err)
	}
	return roomFromUpdateFreezeRow(row), nil
}

// ExtendExpires bumps the room's expires_at timestamp.
func (r *Rooms) ExtendExpires(ctx context.Context, id uuid.UUID, newExpires time.Time) error {
	affected, err := r.q.ExtendRoomExpires(ctx, editordb.ExtendRoomExpiresParams{
		ID:        sharedpg.UUID(id),
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
		RoomID: sharedpg.UUID(in.RoomID),
		UserID: sharedpg.UUID(in.UserID),
		Role:   in.Role.String(),
	})
	if err != nil {
		return domain.Participant{}, fmt.Errorf("editor.Participants.Add: %w", err)
	}
	return participantFromRow(row), nil
}

// List returns all participants of a room.
func (p *Participants) List(ctx context.Context, roomID uuid.UUID) ([]domain.Participant, error) {
	rows, err := p.q.ListParticipants(ctx, sharedpg.UUID(roomID))
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
		RoomID: sharedpg.UUID(roomID),
		UserID: sharedpg.UUID(userID),
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

// Sqlc генерирует отдельные Row-типы для каждого RETURNING-варианта
// (CreateRoomRow, GetRoomRow, UpdateRoomFreezeRow), даже если набор колонок
// совпадает. Чтобы не дублировать assembly-логику — выносим в один buildRoom
// helper, принимающий уже распакованные fields.

func buildRoom(
	id, ownerID, taskID pgtype.UUID,
	roomType, language, visibility string,
	isFrozen bool,
	expiresAt, createdAt pgtype.Timestamptz,
) domain.Room {
	vis := domain.Visibility(visibility)
	if vis == "" {
		// pre-migration rows + race-windows safety: default к shared.
		vis = domain.VisibilityShared
	}
	out := domain.Room{
		ID:         sharedpg.UUIDFrom(id),
		OwnerID:    sharedpg.UUIDFrom(ownerID),
		Type:       domain.RoomType(roomType),
		Language:   enums.Language(language),
		IsFrozen:   isFrozen,
		Visibility: vis,
		ExpiresAt:  expiresAt.Time,
		CreatedAt:  createdAt.Time,
	}
	if taskID.Valid {
		t := sharedpg.UUIDFrom(taskID)
		out.TaskID = &t
	}
	return out
}

func roomFromCreateRow(r editordb.CreateRoomRow) domain.Room {
	return buildRoom(r.ID, r.OwnerID, r.TaskID, r.Type, r.Language, r.Visibility, r.IsFrozen, r.ExpiresAt, r.CreatedAt)
}

func roomFromGetRow(r editordb.GetRoomRow) domain.Room {
	return buildRoom(r.ID, r.OwnerID, r.TaskID, r.Type, r.Language, r.Visibility, r.IsFrozen, r.ExpiresAt, r.CreatedAt)
}

func roomFromUpdateFreezeRow(r editordb.UpdateRoomFreezeRow) domain.Room {
	return buildRoom(r.ID, r.OwnerID, r.TaskID, r.Type, r.Language, r.Visibility, r.IsFrozen, r.ExpiresAt, r.CreatedAt)
}

func participantFromRow(r editordb.EditorParticipant) domain.Participant {
	return domain.Participant{
		RoomID:   sharedpg.UUIDFrom(r.RoomID),
		UserID:   sharedpg.UUIDFrom(r.UserID),
		Role:     enums.EditorRole(r.Role),
		JoinedAt: r.JoinedAt.Time,
	}
}

// Interface guards.
var (
	_ domain.RoomRepo        = (*Rooms)(nil)
	_ domain.ParticipantRepo = (*Participants)(nil)
)
