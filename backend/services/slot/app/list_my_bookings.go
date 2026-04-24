package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/slot/domain"

	"github.com/google/uuid"
)

// ListMyBookings implements GET /slot/my/bookings — every booking owned by
// the authenticated caller, with the joined slot row inlined for one-shot
// rendering on the "Мои слоты" panel.
//
// Pure read-model wrapper: no domain rules apply, just a typed projection
// of the BookingRepo.ListByCandidate query.
type ListMyBookings struct {
	Bookings domain.BookingRepo
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
	return rows, nil
}
