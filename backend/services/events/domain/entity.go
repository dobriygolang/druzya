// Package domain — events bounded context (bible §9 Phase 6.5.3).
//
// Event живёт внутри circle. Membership-gates прокидываются через
// CircleAuthority interface — events-сервис не импортит circles/domain
// напрямую, чтобы оба context'а оставались независимыми.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Recurrence — pattern enum (mirrors proto EventRecurrence).
type Recurrence string

const (
	RecurrenceNone         Recurrence = "none"
	RecurrenceWeeklyFriday Recurrence = "weekly_friday"
)

func (r Recurrence) Valid() bool {
	switch r {
	case RecurrenceNone, RecurrenceWeeklyFriday:
		return true
	}
	return false
}

// Event is the persistent events row.
type Event struct {
	ID               uuid.UUID
	CircleID         uuid.UUID
	Title            string
	Description      string
	StartsAt         time.Time
	DurationMin      int
	EditorRoomID     *uuid.UUID
	WhiteboardRoomID *uuid.UUID
	Recurrence       Recurrence
	CreatedBy        uuid.UUID
	CreatedAt        time.Time
}

// EventWithCircleName — read projection: events page renders
// "<Circle> · <Event title>" without a separate fetch.
type EventWithCircleName struct {
	Event
	CircleName string
}

// Participant is one event_participants row.
type Participant struct {
	EventID  uuid.UUID
	UserID   uuid.UUID
	JoinedAt time.Time
}

// ParticipantWithUsername — projection joined on users.username.
type ParticipantWithUsername struct {
	Participant
	Username string
}

var (
	ErrNotFound  = errors.New("events: not found")
	ErrForbidden = errors.New("events: forbidden")
	ErrConflict  = errors.New("events: conflict")
)
