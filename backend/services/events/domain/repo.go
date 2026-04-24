//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
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
