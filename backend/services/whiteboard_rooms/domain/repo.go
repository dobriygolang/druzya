//go:generate mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is the canonical not-found sentinel for this domain.
var ErrNotFound = errors.New("whiteboard_rooms: not found")

// ErrForbidden is returned when the caller cannot perform an action
// (e.g. non-owner attempts to delete).
var ErrForbidden = errors.New("whiteboard_rooms: forbidden")

// ErrExpired is returned when the room has passed expires_at.
var ErrExpired = errors.New("whiteboard_rooms: expired")

// RoomRepo persists whiteboard_rooms rows.
type RoomRepo interface {
	Create(ctx context.Context, r Room) (Room, error)
	Get(ctx context.Context, id uuid.UUID) (Room, error)
	ListByUser(ctx context.Context, userID uuid.UUID) ([]Room, error)
	UpdateSnapshot(ctx context.Context, id uuid.UUID, snapshot []byte, expires time.Time) error
	// SetVisibility flips visibility flag — частный case UpdateRoom который
	// мы избегаем плодить целиком (только одно поле меняется). Owner-check
	// делает caller (use case).
	SetVisibility(ctx context.Context, id uuid.UUID, visibility Visibility) error
	Delete(ctx context.Context, id uuid.UUID) error
}

// ParticipantRepo persists whiteboard_room_participants rows.
type ParticipantRepo interface {
	Add(ctx context.Context, p Participant) (Participant, error)
	List(ctx context.Context, roomID uuid.UUID) ([]ParticipantWithUsername, error)
	Exists(ctx context.Context, roomID, userID uuid.UUID) (bool, error)
}

// TokenVerifier removed 2026-05-12 (D4/Stream F) — WS handshake gone (peer-
// collab dropped). Connect-RPC auth уже handled by sharedMw на router-level;
// нам больше не нужен per-domain JWT verifier.
