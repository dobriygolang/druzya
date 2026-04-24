package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/shared/enums"
	"druz9/slot/domain"

	"github.com/google/uuid"
)

// ListMyBookings implements GET /slot/my/bookings — every booking owned by
// the authenticated caller, with the joined slot row inlined for one-shot
// rendering on the "Мои слоты" panel.
//
// HasReview is hydrated per-row from an out-of-band provider (review service
// in the monolith). When the provider is nil, has_review stays false — used
// in tests + as a defensive default.
type ListMyBookings struct {
	Bookings  domain.BookingRepo
	HasReview domain.BookingHasReviewProvider
}

// ListMyBookingsInput is the parsed HTTP input — caller is identified by
// the bearer token.
type ListMyBookingsInput struct {
	CandidateID uuid.UUID
}

// Do returns the candidate's bookings ordered by slot.starts_at DESC. An
// empty slice (200 OK with []) is the contract for users without bookings —
// repo's ErrNotFound is mapped to that here so callers don't have to.
func (uc *ListMyBookings) Do(ctx context.Context, in ListMyBookingsInput) ([]domain.BookingWithSlot, error) {
	rows, err := uc.Bookings.ListByCandidate(ctx, in.CandidateID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return []domain.BookingWithSlot{}, nil
		}
		return nil, fmt.Errorf("slot.ListMyBookings: %w", err)
	}
	if uc.HasReview == nil {
		return rows, nil
	}
	for i := range rows {
		// Skip the lookup for non-completed slots — they can't have a review
		// anyway, and we save a round-trip per row in the common "upcoming
		// bookings" case.
		if rows[i].Slot.Status != enums.SlotStatusCompleted {
			continue
		}
		has, herr := uc.HasReview.HasReview(ctx, rows[i].Booking.ID)
		if herr != nil {
			// Don't fail the listing on a stats lookup — log via caller.
			continue
		}
		rows[i].HasReview = has
	}
	return rows, nil
}
