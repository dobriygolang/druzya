package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/shared/enums"
	"druz9/slot/domain"

	"github.com/google/uuid"
)

// ListHostedBookings — interviewer-side projection: bookings on slots
// they OWN. Hydrates HasReview using INTERVIEWER_TO_CANDIDATE direction
// so the «Я как интервьюер» drawer can gate the «Оставить отзыв о
// кандидате» CTA.
type ListHostedBookings struct {
	Bookings  domain.BookingRepo
	HasReview domain.BookingHasReviewProvider
}

type ListHostedBookingsInput struct {
	InterviewerID uuid.UUID
}

func (uc *ListHostedBookings) Do(ctx context.Context, in ListHostedBookingsInput) ([]domain.HostedBooking, error) {
	rows, err := uc.Bookings.ListHostedByInterviewer(ctx, in.InterviewerID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return []domain.HostedBooking{}, nil
		}
		return nil, fmt.Errorf("slot.ListHostedBookings: %w", err)
	}
	if uc.HasReview == nil {
		return rows, nil
	}
	for i := range rows {
		if rows[i].Slot.Status != enums.SlotStatusCompleted {
			continue
		}
		has, herr := uc.HasReview.HasReview(ctx, rows[i].Booking.ID, "interviewer_to_candidate")
		if herr != nil {
			continue
		}
		rows[i].HasReview = has
	}
	return rows, nil
}
