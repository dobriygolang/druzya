//go:generate mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// EventRepo persists events rows.
type EventRepo interface {
	Create(ctx context.Context, e Event) (Event, error)
	Get(ctx context.Context, id uuid.UUID) (EventWithCircleName, error)
	ListUpcomingByMember(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]EventWithCircleName, error)
	Delete(ctx context.Context, id uuid.UUID) error
	// DeleteEndedBefore removes events whose end (starts_at + duration_min)
	// is strictly before the cutoff. Returns deleted row count. Used by the
	// cleanup worker; event_participants cascade via FK.
	DeleteEndedBefore(ctx context.Context, cutoff time.Time) (int64, error)
	// FindStartingSoon returns events scheduled to start in
	// (now+lowerOffset, now+upperOffset], flattened to (event, participant)
	// pairs. Used by the starting-soon notifier — it inserts an idempotency
	// row per pair so overlapping windows don't double-notify.
	FindStartingSoon(ctx context.Context, lowerOffset, upperOffset time.Duration) ([]ParticipantNotificationCandidate, error)
}

// ParticipantNotificationCandidate is a flat (event, user) pair the
// scheduler needs in a single sweep.
type ParticipantNotificationCandidate struct {
	EventID  uuid.UUID
	UserID   uuid.UUID
	Title    string
	StartsAt time.Time
	CircleID uuid.UUID
}

// EventNotificationLedger persists idempotency markers for outbound event
// notifications. The scheduler calls MarkSent(eventID, userID, kind) and
// only acts on the row if `inserted` came back true — anything else means
// another worker already claimed the slot.
type EventNotificationLedger interface {
	MarkSent(ctx context.Context, eventID, userID uuid.UUID, kind string, sentAt time.Time) (inserted bool, err error)
}

// ParticipantRepo persists event_participants rows.
type ParticipantRepo interface {
	Add(ctx context.Context, p Participant) (Participant, error)
	Remove(ctx context.Context, eventID, userID uuid.UUID) error
	List(ctx context.Context, eventID uuid.UUID) ([]ParticipantWithUsername, error)
}

// CircleAuthority — narrow port to circles bounded context. Implemented in
// monolith wiring as an adapter over circles/app.Handlers.
type CircleAuthority interface {
	IsAdmin(ctx context.Context, circleID, userID uuid.UUID) (bool, error)
	IsMember(ctx context.Context, circleID, userID uuid.UUID) (bool, error)
}
