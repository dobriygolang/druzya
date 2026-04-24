package domain

import (
	"context"

	"github.com/google/uuid"
)

// ReviewRepo abstracts the persistence layer for reviews.
type ReviewRepo interface {
	// Create inserts a new review row. A duplicate booking_id surfaces as
	// ErrAlreadyReviewed (the repo translates the unique-violation).
	Create(ctx context.Context, r Review) (Review, error)
	// GetByBooking returns the review attached to a booking, ErrNotFound when
	// the candidate hasn't reviewed yet.
	GetByBooking(ctx context.Context, bookingID uuid.UUID) (Review, error)
	// ListByInterviewer returns the latest N reviews ordered by created_at DESC.
	ListByInterviewer(ctx context.Context, interviewerID uuid.UUID, limit int) ([]Review, error)
	// InterviewerStats returns aggregate stats for the interviewer (avg + count).
	InterviewerStats(ctx context.Context, interviewerID uuid.UUID) (Stats, error)
	// HasReview returns true when the booking already has a review row.
	// Used by slot.ListMyBookings (cross-service) to set MyBookingItem.has_review.
	HasReview(ctx context.Context, bookingID uuid.UUID) (bool, error)
}
