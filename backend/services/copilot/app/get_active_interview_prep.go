// get_active_interview_prep.go — Phase J / C6 (P1).
//
// Reads the user's active interview-prep row. Returns ok=false for the
// no-active case so the desktop client can render the "upload CV/JD"
// empty state without an exception path.
package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

type GetActiveInterviewPrep struct {
	Preps domain.InterviewPrepRepo
}

type GetActiveInterviewPrepInput struct {
	UserID uuid.UUID
}

type GetActiveInterviewPrepResult struct {
	Active bool
	Prep   domain.InterviewPrep
}

func (uc *GetActiveInterviewPrep) Do(ctx context.Context, in GetActiveInterviewPrepInput) (GetActiveInterviewPrepResult, error) {
	if in.UserID == uuid.Nil {
		return GetActiveInterviewPrepResult{}, fmt.Errorf("copilot.GetActiveInterviewPrep: %w: user id required", domain.ErrInvalidInput)
	}
	prep, err := uc.Preps.GetActive(ctx, in.UserID)
	if err != nil {
		if errors.Is(err, domain.ErrNoActivePrep) {
			return GetActiveInterviewPrepResult{Active: false}, nil
		}
		return GetActiveInterviewPrepResult{}, fmt.Errorf("copilot.GetActiveInterviewPrep: %w", err)
	}
	return GetActiveInterviewPrepResult{Active: true, Prep: prep}, nil
}

// EndInterviewPrep clears the user's active prep. Idempotent.
type EndInterviewPrep struct {
	Preps domain.InterviewPrepRepo
}

type EndInterviewPrepInput struct {
	UserID    uuid.UUID
	SessionID uuid.UUID // uuid.Nil → "end the current active"
}

func (uc *EndInterviewPrep) Do(ctx context.Context, in EndInterviewPrepInput) error {
	if in.UserID == uuid.Nil {
		return fmt.Errorf("copilot.EndInterviewPrep: %w: user id required", domain.ErrInvalidInput)
	}
	if err := uc.Preps.EndActive(ctx, in.UserID, in.SessionID); err != nil {
		return fmt.Errorf("copilot.EndInterviewPrep: %w", err)
	}
	return nil
}
