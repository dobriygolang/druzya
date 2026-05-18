// Package domain contains the entities and repository interfaces for the
// shared-whiteboard bounded context.
//
// A Room is a solo Excalidraw canvas persisted as an opaque snapshot blob;
// the older peer-collab Yjs sync hub has been dropped. Private drawings
// live in a separate bounded context (the hone whiteboards) — do not
// conflate them.
package domain

import (
	"time"

	"github.com/google/uuid"
)

// DefaultTTL is how long a freshly-minted room lives before GC. Extended
// implicitly whenever the hub flushes a snapshot (active room == relevant).
const DefaultTTL = 24 * time.Hour

// Visibility — 'private' = только owner, 'shared' = любой
// с URL может join'ить (legacy default до миграции 00036).
type Visibility string

const (
	VisibilityPrivate Visibility = "private"
	VisibilityShared  Visibility = "shared"
)

// Room is the persistent whiteboard_rooms row.
type Room struct {
	ID         uuid.UUID
	OwnerID    uuid.UUID
	Title      string
	Snapshot   []byte
	Visibility Visibility
	ExpiresAt  time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// Participant is one whiteboard_room_participants row.
type Participant struct {
	RoomID   uuid.UUID
	UserID   uuid.UUID
	JoinedAt time.Time
}

// ParticipantWithUsername is the projection used by GetRoom — joined on
// users.username for UI chip labels.
type ParticipantWithUsername struct {
	Participant
	Username string
}
