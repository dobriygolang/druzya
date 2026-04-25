// Package domain contains the entities, value objects and repository interfaces
// for the editor bounded context. No external framework imports here.
//
// The editor domain is the foundation of every active-coding mode in druz9
// (bible §3.1). A Room owns participants, Yjs/CRDT operations and the freeze
// flag. Replay buffers live in-memory on the hub and are flushed to MinIO at
// room-close time or on GET /replay.
//
// solution_hint (from tasks) NEVER crosses the API boundary — same rule as
// ai_mock / ai_native. We keep the editor hint-free: only TaskPublic is
// handed to callers.
package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// RoomType mirrors the openapi CreateRoomRequest.type enum (practice /
// interview / pair_mock). Kept domain-local so domain has zero apigen dep.
type RoomType string

const (
	RoomTypePractice  RoomType = "practice"
	RoomTypeInterview RoomType = "interview"
	RoomTypePairMock  RoomType = "pair_mock"
)

// IsValid powers `exhaustive` switches.
func (t RoomType) IsValid() bool {
	switch t {
	case RoomTypePractice, RoomTypeInterview, RoomTypePairMock:
		return true
	}
	return false
}

// String satisfies fmt.Stringer.
func (t RoomType) String() string { return string(t) }

// Room is the persistent editor_rooms row.
type Room struct {
	ID         uuid.UUID
	OwnerID    uuid.UUID
	Type       RoomType
	TaskID     *uuid.UUID
	Language   enums.Language
	IsFrozen   bool
	Visibility Visibility
	ExpiresAt  time.Time
	CreatedAt  time.Time
}

// Visibility — кто может входить в комнату по share-link.
//   - "shared" (default): любой со ссылкой; auto-add as participant.
//   - "private": только owner; гостям и новичкам 403.
type Visibility string

const (
	VisibilityShared  Visibility = "shared"
	VisibilityPrivate Visibility = "private"
)

// IsValid — для CHECK constraint валидации в handler'ах.
func (v Visibility) IsValid() bool {
	switch v {
	case VisibilityShared, VisibilityPrivate:
		return true
	}
	return false
}

// Participant is one editor_participants row.
type Participant struct {
	RoomID   uuid.UUID
	UserID   uuid.UUID
	Role     enums.EditorRole
	JoinedAt time.Time
}

// TaskPublic mirrors the client-safe task projection (no solution_hint).
// Embedded here so the editor domain has no cross-domain import.
type TaskPublic struct {
	ID          uuid.UUID
	Slug        string
	Title       string
	Description string
	Difficulty  enums.Difficulty
	Section     enums.Section
}

// InviteLink is the HMAC'd invite payload + expiry.
type InviteLink struct {
	URL       string
	Token     string
	ExpiresAt time.Time
}

// ReplayURL is a presigned object-storage URL with a TTL (bible §3.1 / §6).
type ReplayURL struct {
	URL       string
	ExpiresAt time.Time
}

// Op is an opaque CRDT (Yjs) payload with a monotonically increasing
// per-room sequence number. The hub stores Op entries in a rolling buffer
// and flushes them to MinIO for replay.
//
// The domain does NOT interpret the payload — it is byte-copied to the
// replay JSONL and broadcast to other connections as-is.
type Op struct {
	Seq       int64
	UserID    uuid.UUID
	Payload   []byte
	CreatedAt time.Time
}

// CursorUpdate is a lightweight presence frame. Not persisted — ephemeral
// broadcast only.
type CursorUpdate struct {
	UserID uuid.UUID
	Line   int
	Column int
}

// LocalEventType is the enum for the editor's INTERNAL event bus. Kept
// local so shared/domain.events.go stays free of editor-specific shapes
// (per spec: "no editor-specific events yet").
type LocalEventType string

const (
	LocalEventParticipantJoined LocalEventType = "participant_joined"
	LocalEventParticipantLeft   LocalEventType = "participant_left"
	LocalEventRoleChange        LocalEventType = "role_change"
	LocalEventFreezeToggle      LocalEventType = "freeze"
	LocalEventOp                LocalEventType = "op"
	LocalEventCursor            LocalEventType = "cursor"
)

// IsValid powers exhaustive switches.
func (t LocalEventType) IsValid() bool {
	switch t {
	case LocalEventParticipantJoined, LocalEventParticipantLeft,
		LocalEventRoleChange, LocalEventFreezeToggle,
		LocalEventOp, LocalEventCursor:
		return true
	}
	return false
}

// LocalEvent is the envelope used on the hub's internal fanout. Payload is a
// free-form map serialised to JSON at broadcast time.
type LocalEvent struct {
	Type    LocalEventType
	RoomID  uuid.UUID
	UserID  uuid.UUID
	Payload map[string]any
	OccurAt time.Time
}
