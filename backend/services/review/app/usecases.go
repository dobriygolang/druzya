// Package app holds the review service use cases. Pure orchestration over
// domain rules and the repo interface — no HTTP or proto types here.
package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/review/domain"

	"github.com/google/uuid"
)

// BookingLookup is the contract review needs from slot to validate that
// (a) the booking exists, (b) the caller is the candidate on it, and (c)
// the slot was completed (only completed sessions are reviewable).
//
// Wiring lives in the monolith — review never imports slot directly.
type BookingLookup interface {
	// LookupBooking returns the candidate, interviewer, and slot status for
	// a given booking_id. ErrNotFound when no row matches.
	LookupBooking(ctx context.Context, bookingID uuid.UUID) (BookingMeta, error)
}

// BookingMeta is the slim projection we need; mirrors slot.BookingWithSlot.
type BookingMeta struct {
	BookingID     uuid.UUID
	CandidateID   uuid.UUID
	InterviewerID uuid.UUID
	// SlotStatus is the canonical short-form slot status (e.g. "completed").
	SlotStatus string
}

// SubjectFor returns who is being reviewed given the direction. Centralised
// here so callers don't redundantly branch on the enum.
func (m BookingMeta) SubjectFor(dir domain.Direction) uuid.UUID {
	if dir == domain.DirInterviewerToCandidate {
		return m.CandidateID
	}
	return m.InterviewerID
}

// CreateReview implements POST /api/v1/review.
type CreateReview struct {
	Reviews  domain.ReviewRepo
	Bookings BookingLookup
	Now      func() time.Time
}

type CreateReviewInput struct {
	BookingID  uuid.UUID
	ReviewerID uuid.UUID // pulled from bearer token by ports
	Direction  domain.Direction
	Rating     int
	Feedback   string
}

// Do validates the request, confirms the caller is on the right side of
// the booking for the requested direction, and writes the review row.
func (uc *CreateReview) Do(ctx context.Context, in CreateReviewInput) (domain.Review, error) {
	if in.BookingID == uuid.Nil {
		return domain.Review{}, fmt.Errorf("review.CreateReview: %w", domain.ErrEmptyBookingID)
	}
	if !in.Direction.IsValid() {
		return domain.Review{}, fmt.Errorf("review.CreateReview: %w", domain.ErrInvalidDir)
	}
	if err := domain.ValidateRating(in.Rating); err != nil {
		return domain.Review{}, fmt.Errorf("review.CreateReview: %w", err)
	}
	meta, err := uc.Bookings.LookupBooking(ctx, in.BookingID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.Review{}, fmt.Errorf("review.CreateReview: %w", domain.ErrNotFound)
		}
		return domain.Review{}, fmt.Errorf("review.CreateReview: lookup booking: %w", err)
	}
	// Only the candidate (for C→I) or the interviewer (for I→C) may post
	// the corresponding direction.
	switch in.Direction {
	case domain.DirCandidateToInterviewer:
		if meta.CandidateID != in.ReviewerID {
			return domain.Review{}, fmt.Errorf("review.CreateReview: not the candidate: %w", domain.ErrForbidden)
		}
	case domain.DirInterviewerToCandidate:
		if meta.InterviewerID != in.ReviewerID {
			return domain.Review{}, fmt.Errorf("review.CreateReview: not the interviewer: %w", domain.ErrForbidden)
		}
	}
	// Only completed slots are reviewable.
	if meta.SlotStatus != "completed" {
		return domain.Review{}, fmt.Errorf("review.CreateReview: slot not completed (status=%s): %w",
			meta.SlotStatus, domain.ErrForbidden)
	}
	out, err := uc.Reviews.Create(ctx, domain.Review{
		BookingID:     in.BookingID,
		Direction:     in.Direction,
		ReviewerID:    in.ReviewerID,
		InterviewerID: meta.InterviewerID,
		SubjectID:     meta.SubjectFor(in.Direction),
		Rating:        in.Rating,
		Feedback:      in.Feedback,
	})
	if err != nil {
		return domain.Review{}, fmt.Errorf("review.CreateReview: %w", err)
	}
	return out, nil
}

// ListByInterviewer implements GET /api/v1/review?interviewer_id=...
// Returns reviews where the interviewer is the SUBJECT — i.e. only
// CANDIDATE→INTERVIEWER rows surface on their public card.
type ListByInterviewer struct {
	Reviews domain.ReviewRepo
}

type ListByInterviewerInput struct {
	InterviewerID uuid.UUID
	Limit         int
}

func (uc *ListByInterviewer) Do(ctx context.Context, in ListByInterviewerInput) ([]domain.Review, error) {
	if in.InterviewerID == uuid.Nil {
		return nil, fmt.Errorf("review.ListByInterviewer: %w", domain.ErrEmptyBookingID)
	}
	out, err := uc.Reviews.ListBySubject(ctx, in.InterviewerID, in.Limit)
	if err != nil {
		return nil, fmt.Errorf("review.ListByInterviewer: %w", err)
	}
	// Defensive: filter to candidate→interviewer only — the public card
	// must never expose interviewer→candidate notes meant for the
	// candidate's own reflection.
	filtered := make([]domain.Review, 0, len(out))
	for _, r := range out {
		if r.Direction == domain.DirCandidateToInterviewer {
			filtered = append(filtered, r)
		}
	}
	return filtered, nil
}

// GetInterviewerStats implements GET /api/v1/review/stats/{interviewer_id}.
// Also called directly by slot.ListSlots via the StatsProvider adapter.
//
// Aggregates only the CANDIDATE→INTERVIEWER reviews — the rating shown on
// the slot card / public profile reflects how candidates rated this person
// as an interviewer. The reverse direction has its own stats path used by
// the candidate's private dashboard (not exposed publicly).
type GetInterviewerStats struct {
	Reviews domain.ReviewRepo
}

func (uc *GetInterviewerStats) Do(ctx context.Context, interviewerID uuid.UUID) (domain.Stats, error) {
	if interviewerID == uuid.Nil {
		return domain.Stats{}, fmt.Errorf("review.GetInterviewerStats: %w", domain.ErrEmptyBookingID)
	}
	st, err := uc.Reviews.SubjectStats(ctx, interviewerID)
	if err != nil {
		return domain.Stats{}, fmt.Errorf("review.GetInterviewerStats: %w", err)
	}
	return st, nil
}
