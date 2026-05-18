// Package domain defines the low-key collab rooms aggregate.
//
// It cross-cuts editor_rooms and whiteboard_rooms via the Kind enum. The
// older per-table services still own their tutor/mock CRUD paths; this
// service exposes the unified view used by standalone create flows
// (Settings → Developer tools).
package domain

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

type Kind string

const (
	KindCode       Kind = "code"
	KindWhiteboard Kind = "whiteboard"
)

func (k Kind) IsValid() bool {
	switch k {
	case KindCode, KindWhiteboard:
		return true
	}
	return false
}

// Room — unified view над editor_rooms / whiteboard_rooms.
type Room struct {
	ID         uuid.UUID
	OwnerID    uuid.UUID
	Kind       Kind
	Title      string
	Visibility string // private|shared
	FreeTier   bool
	ExpiresAt  time.Time
	ArchivedAt *time.Time // nil = active
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// Repo handles reads and writes against both tables. Concrete implementations
// dispatch on Kind to pick which table to touch.
type Repo interface {
	Create(ctx context.Context, r Room) (Room, error)
	Get(ctx context.Context, kind Kind, id uuid.UUID) (Room, error)
	ListMy(ctx context.Context, ownerID uuid.UUID, status Status) ([]Room, error)
	ExtendExpiry(ctx context.Context, kind Kind, id uuid.UUID, newExpiry time.Time) error
	Archive(ctx context.Context, kind Kind, id uuid.UUID, at time.Time) error
	Restore(ctx context.Context, kind Kind, id uuid.UUID) error
	// ListExpiredCandidates feeds the TTL sweep cron.
	ListExpiredCandidates(ctx context.Context, before time.Time, limit int) ([]Room, error)
}

type Status string

const (
	StatusActive Status = "active" // expires_at > now() AND archived_at IS NULL
	StatusPast   Status = "past"   // archived_at IS NOT NULL OR expires_at <= now()
	StatusAll    Status = "all"
)

// QuotaRepo tracks the per-user `user_room_quota` row.
type QuotaRepo interface {
	Get(ctx context.Context, userID uuid.UUID) (Quota, error)
	Increment(ctx context.Context, userID uuid.UUID, tier string) error
	Decrement(ctx context.Context, userID uuid.UUID) error
	// Recompute reconciles active_count against the actual room rows. Run
	// daily so drift from failed increment/decrement attempts does not
	// accumulate.
	Recompute(ctx context.Context, userID uuid.UUID, count int) error
}

type Quota struct {
	UserID      uuid.UUID
	ActiveCount int
	Tier        string // free|pro
	PeriodStart time.Time
}

// Free-tier limits.
const (
	FreeMaxActive       = 3
	FreeTTL             = 24 * time.Hour
	FreeMaxParticipants = 3
	RestoreWindow       = 30 * 24 * time.Hour
)

// Errors.
var (
	ErrInvalidKind     = errors.New("rooms: invalid kind")
	ErrNotFound        = errors.New("rooms: not found")
	ErrQuotaExceeded   = errors.New("rooms: free-tier quota exceeded")
	ErrNotOwner        = errors.New("rooms: not owner")
	ErrAlreadyArchived = errors.New("rooms: already archived")
	ErrProRequired     = errors.New("rooms: pro-tier required")
	ErrUserBlocked     = errors.New("rooms: user blocked")
)

// AbuseChecker blocks banned users (admin ban or domain_reputation signal)
// before any quota work. Implementations look up by user_id, or by host
// when a share-link signal is available. Nil at the CreateRoom UC means
// no check.
type AbuseChecker interface {
	IsUserBlocked(ctx context.Context, userID uuid.UUID) (bool, error)
}
