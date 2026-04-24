// Package domain holds the review (mock-interview feedback) entities and
// repository interfaces. No framework imports.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Sentinel errors.
var (
	ErrNotFound        = errors.New("review: not found")
	ErrForbidden       = errors.New("review: forbidden")
	ErrAlreadyReviewed = errors.New("review: booking already reviewed")
	ErrInvalidRating   = errors.New("review: rating must be in [1, 5]")
	ErrEmptyBookingID  = errors.New("review: booking_id required")
	ErrInvalidDir      = errors.New("review: invalid direction")
)

// Direction differentiates "candidate reviews interviewer" from
// "interviewer reviews candidate".
type Direction string

const (
	DirCandidateToInterviewer Direction = "candidate_to_interviewer"
	DirInterviewerToCandidate Direction = "interviewer_to_candidate"
)

func (d Direction) IsValid() bool {
	return d == DirCandidateToInterviewer || d == DirInterviewerToCandidate
}

// Rating bounds.
const (
	MinRating = 1
	MaxRating = 5
)

// Review mirrors a `reviews` row.
type Review struct {
	BookingID     uuid.UUID
	Direction     Direction
	ReviewerID    uuid.UUID
	InterviewerID uuid.UUID
	SubjectID     uuid.UUID
	Rating        int
	Feedback      string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// Stats is the aggregate served to slot.ListSlots for hydrating the
// InterviewerCard. avg_rating is 0 when count == 0 — callers decide
// whether to render that as "no rating yet".
//
// Aggregated across BOTH review directions for a given subject — the
// public card on /interviewer/:id shows their composite rating.
type Stats struct {
	SubjectID    uuid.UUID
	AvgRating    float32
	ReviewsCount int
}

// ValidateRating enforces the [1,5] range used in the migration's CHECK.
// Centralised here so the app layer doesn't reimplement it.
func ValidateRating(r int) error {
	if r < MinRating || r > MaxRating {
		return ErrInvalidRating
	}
	return nil
}
