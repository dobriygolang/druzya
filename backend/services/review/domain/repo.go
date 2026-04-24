package domain

import (
	"context"

	"github.com/google/uuid"
)

// ReviewRepo abstracts the persistence layer for reviews.
type ReviewRepo interface {
	// Create inserts a new review row. Duplicate (booking_id, direction)
	// surfaces as ErrAlreadyReviewed.
	Create(ctx context.Context, r Review) (Review, error)
	// GetByBookingDirection returns the review for one side of a booking,
	// ErrNotFound when absent.
	GetByBookingDirection(ctx context.Context, bookingID uuid.UUID, direction Direction) (Review, error)
	// ListBySubject returns the latest N reviews about a user (any direction).
	ListBySubject(ctx context.Context, subjectID uuid.UUID, limit int) ([]Review, error)
	// SubjectStats returns aggregate stats for the user being reviewed
	// (avg + count) across both directions.
	SubjectStats(ctx context.Context, subjectID uuid.UUID) (Stats, error)
	// HasReview reports whether a row already exists for the (booking,
	// direction) pair. Used by slot.ListMyBookings / ListHostedBookings
	// (cross-service) to gate the «Оставить отзыв» CTA.
	HasReview(ctx context.Context, bookingID uuid.UUID, direction Direction) (bool, error)
}
