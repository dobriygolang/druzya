//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// SlotRepo is the Postgres-backed persistence port for slots.
type SlotRepo interface {
	// Create inserts a new slot. The returned Slot has ID/CreatedAt populated.
	Create(ctx context.Context, s Slot) (Slot, error)

	// GetByID returns a slot by id (without interviewer stats hydrated).
	// Returns ErrNotFound when missing.
	GetByID(ctx context.Context, id uuid.UUID) (Slot, error)

	// List returns filtered slots. When no explicit status filter is set the
	// infra implementation restricts to `available` + upcoming by default.
	List(ctx context.Context, f ListFilter) ([]Slot, error)

	// ListByInterviewer returns all slots owned by the interviewer whose
	// [starts_at, ends_at) overlaps the [from, to] window. Used for
	// overlap detection.
	ListByInterviewer(ctx context.Context, interviewerID uuid.UUID, from, to time.Time) ([]Slot, error)

	// UpdateStatus sets the status column.
	UpdateStatus(ctx context.Context, id uuid.UUID, status string) error

	// BookAtomically performs the booking in a single DB transaction:
	//   1) SELECT … FOR UPDATE the slot
	//   2) verify status=available and starts_at in the future
	//   3) flip status to booked
	//   4) INSERT booking row with meet_url
	// On success it returns the fully-populated booking. Returns
	// ErrNotAvailable when the slot is not bookable, ErrPastStart when in
	// the past, ErrNotFound when missing.
	BookAtomically(ctx context.Context, slotID, candidateID uuid.UUID, meetURL string) (Booking, error)

	// CancelSlotWithBooking cancels the slot and (if present) the booking
	// atomically. Returns the booking that was cancelled (zero value when
	// there was none) so the caller can notify the candidate.
	CancelSlotWithBooking(ctx context.Context, slotID uuid.UUID) (Booking, bool, error)
}

// BookingRepo persists the `bookings` table reads independently of slots.
type BookingRepo interface {
	// GetBySlotID returns the booking attached to a slot, or ErrBookingNotFound.
	GetBySlotID(ctx context.Context, slotID uuid.UUID) (Booking, error)

	// ListByCandidate returns every booking owned by the candidate, hydrated
	// with the parent Slot. Ordered by Slot.StartsAt DESC so the page can
	// show "upcoming on top, then past". Returns an empty slice (not error)
	// when the candidate has nothing booked.
	ListByCandidate(ctx context.Context, candidateID uuid.UUID) ([]BookingWithSlot, error)

	// GetWithSlotByID returns a single booking joined with its parent slot.
	// Used by cross-service callers (review.CreateReview) that need to verify
	// ownership and slot status before writing a related row.
	GetWithSlotByID(ctx context.Context, bookingID uuid.UUID) (BookingWithSlot, error)
}

// BookingWithSlot is the read-model used by /slot/my/bookings: a booking row
// joined with its parent slot, so the candidate-facing list can render
// "когда / какой раздел / meet-ссылка" без отдельного N+1 хвоста.
//
// HasReview is hydrated by the app layer via BookingHasReviewProvider —
// false until the candidate leaves a review for this booking. UI uses it to
// gate the «Оставить отзыв» CTA.
type BookingWithSlot struct {
	Booking    Booking
	Slot       Slot
	HasReview  bool
}

// ReviewRepo provides interviewer-rating stats for ListSlots' SlotInterviewer
// hydration. The implementation lives outside the slot service since the
// `reviews` table is owned by the review (mock-interview feedback) bounded
// context — see /Users/sedorofeevd/Desktop/druzya/backend/services/review.
//
// The monolith wires a thin adapter (cmd/monolith/services/slot.go) that
// delegates each call into review.app.GetInterviewerStats.
type ReviewRepo interface {
	// InterviewerStats returns (avgRating, reviewCount) across every review
	// the interviewer has received. A user with zero reviews gets (0, 0).
	InterviewerStats(ctx context.Context, interviewerID uuid.UUID) (float32, int, error)
}

// BookingHasReviewProvider is consumed by ListMyBookings to set the
// `has_review` flag on each booking item. Same cross-service pattern as
// ReviewRepo — implementation lives in the review service.
type BookingHasReviewProvider interface {
	HasReview(ctx context.Context, bookingID uuid.UUID) (bool, error)
}

// MeetRoomProvider abstracts the generation of the video-meet URL attached to
// a booking.
//
// STUB: the MVP implementation returns a deterministic mock URL
// (https://meet.google.com/mock-{slotID}). The real implementation will
// exchange the interviewer's Google OAuth token for an ephemeral Google Meet
// link via the Calendar API — future work, tracked separately.
type MeetRoomProvider interface {
	// GenerateMeetURL creates a meet URL scoped to the slot. Must be
	// idempotent — the same slot id must produce the same URL on retries.
	GenerateMeetURL(ctx context.Context, slotID uuid.UUID) (string, error)
}
