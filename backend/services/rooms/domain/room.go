// Package domain — Phase 9a Path C low-key collab rooms.
//
// Cross-cuts existing editor_rooms + whiteboard_rooms tables через `kind`
// enum. Не дублирует CRUD'ы (editor / whiteboard сервисы продолжают свою
// логику для tutor/mock workflows); этот сервис экспонирует unified
// view для standalone-create через Settings → Developer tools.
package domain

import (
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

// Repo — write+read над обеими таблицами. Concrete impl выбирает
// которую таблицу хитить по Kind.
type Repo interface {
	Create(ctx ctxValue, r Room) (Room, error)
	Get(ctx ctxValue, kind Kind, id uuid.UUID) (Room, error)
	ListMy(ctx ctxValue, ownerID uuid.UUID, status Status) ([]Room, error)
	ExtendExpiry(ctx ctxValue, kind Kind, id uuid.UUID, newExpiry time.Time) error
	Archive(ctx ctxValue, kind Kind, id uuid.UUID, at time.Time) error
	Restore(ctx ctxValue, kind Kind, id uuid.UUID) error
	// Cron support — все expired non-archived rows.
	ListExpiredCandidates(ctx ctxValue, before time.Time, limit int) ([]Room, error)
}

type ctxValue = interface{} // type-alias чтобы не тянуть context import в domain (минимизировать deps).

type Status string

const (
	StatusActive   Status = "active"   // expires_at > now() AND archived_at IS NULL
	StatusPast     Status = "past"     // archived_at IS NOT NULL OR expires_at <= now()
	StatusAll      Status = "all"
)

// QuotaRepo — per-user `user_room_quota`.
type QuotaRepo interface {
	Get(ctx ctxValue, userID uuid.UUID) (Quota, error)
	Increment(ctx ctxValue, userID uuid.UUID, tier string) error
	Decrement(ctx ctxValue, userID uuid.UUID) error
	// Recompute — sync active_count с фактическим count'ом из rooms tables.
	// Daily cron вызывает чтобы избежать drift'а.
	Recompute(ctx ctxValue, userID uuid.UUID, count int) error
}

type Quota struct {
	UserID      uuid.UUID
	ActiveCount int
	Tier        string // free|pro
	PeriodStart time.Time
}

// Limits для free-tier (Sergey 2026-05-04 Path C low-key).
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

// AbuseChecker — Phase 9a §spam mitigation. Blocked users (через
// `domain_reputation` или admin manual ban) не могут create rooms.
// Implementation проверяет user_id или (когда есть share-link domain
// signal) — host из share-URL recipient'а. nil → no-check.
type AbuseChecker interface {
	IsUserBlocked(ctx ctxValue, userID uuid.UUID) (bool, error)
}
