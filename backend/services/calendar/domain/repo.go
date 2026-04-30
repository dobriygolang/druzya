package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Repo is the persistence port for personal_events. Adapters live in infra.
//
// Read-side operations come in two flavours:
//   - ListByUser/ListUpcoming — UI surfaces (calendar grid, Hone Today).
//   - ListUpcomingForCoach    — narrower projection used by intelligence,
//     joined with companies(name) for prompt rendering.
//
// Mutations are through whole-event Update — there is no partial PATCH at
// the repo layer; use cases above compose the desired shape and hand it
// down. Outcome capture has its own UpsertOutcome path because it's a
// distinct user gesture (post-event reflection) and we want a focused
// SQL that touches only the outcome columns.
type Repo interface {
	Create(ctx context.Context, e Event) (Event, error)
	Get(ctx context.Context, userID, eventID uuid.UUID) (Event, error)
	Update(ctx context.Context, e Event) (Event, error)
	Delete(ctx context.Context, userID, eventID uuid.UUID) error

	// ListByUser returns events for a user inside [from, to). Empty kinds
	// means "every kind". Order: starts_at ASC.
	ListByUser(ctx context.Context, userID uuid.UUID, from, to time.Time, kinds []Kind) ([]EventWithCompany, error)

	// ListUpcomingForCoach returns events with starts_at in
	// [today, today + withinDays] joined with companies(name). Status is
	// always 'planned' here — finished/cancelled events fall out. Used by
	// intelligence reader.
	ListUpcomingForCoach(ctx context.Context, userID uuid.UUID, withinDays int) ([]EventWithCompany, error)

	// SetStatus transitions an event to a new lifecycle state. Stamps
	// finished_at when the new status is 'done' or 'cancelled' or
	// 'no_show'. Rejects invalid status with ErrInvalidInput.
	SetStatus(ctx context.Context, userID, eventID uuid.UUID, status Status) (Event, error)

	// UpsertOutcome captures the post-event reflection (felt_score,
	// outcome_md). Auto-flips status to 'done' if still 'planned' or
	// 'live' and writes finished_at if not set.
	UpsertOutcome(ctx context.Context, userID, eventID uuid.UUID, feltScore *int, outcomeMD string) (Event, error)
}
