package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Sentinels.
var (
	ErrNotFound       = errors.New("friends: not found")
	ErrSelfFriendship = errors.New("friends: cannot friend self")
	ErrAlreadyExists  = errors.New("friends: relation already exists")
	ErrInvalidStatus  = errors.New("friends: invalid status transition")
	ErrCodeExpired    = errors.New("friends: code expired")
)

// Status — состояние дружбы.
type Status string

const (
	StatusPending  Status = "pending"
	StatusAccepted Status = "accepted"
	StatusBlocked  Status = "blocked"
)

// Friendship — одна строка в friendships.
type Friendship struct {
	ID          int64
	RequesterID uuid.UUID
	AddresseeID uuid.UUID
	Status      Status
	CreatedAt   time.Time
	AcceptedAt  *time.Time
}

// FriendCode — короткий код для invite-flow.
type FriendCode struct {
	UserID    uuid.UUID
	Code      string
	ExpiresAt time.Time
}

// IsExpired — true если истёк срок действия.
func (c FriendCode) IsExpired(now time.Time) bool { return now.After(c.ExpiresAt) }

// FriendListEntry — DTO для UI: friend + denormalised данные с join'ов.
//
// Список собирается в repo (PgFriendRepo.ListAccepted) одной выборкой —
// тут нет лишних роутингов.
//
// Anti-fallback: the Online bool was removed. There is no presence service
// that fills it; the previous AlwaysOffline stub used to write `false` for
// every entry. When real presence lands, add a separate PresenceProvider
// port and merge it in the use case — do NOT add a hard-coded fallback.
type FriendListEntry struct {
	UserID      uuid.UUID
	Username    string
	DisplayName string
	AvatarFrame string
	Tier        string // best section + ELO bucket label, пустое если нет
	LastMatchAt *time.Time
}
