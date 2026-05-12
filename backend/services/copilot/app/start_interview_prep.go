// start_interview_prep.go — Phase J / C6 (P1).
//
// StartInterviewPrep commits the already-parsed CV + JD shapes as the
// user's CURRENT active interview prep. Single-active invariant lives
// in the repo (transactional end-prior + insert-new). Subsequent
// Analyze / Chat / Suggest turns the Cue desktop fires consult this
// row via InterviewPrepProvider and inject a tailored system block.
package app

import (
	"context"
	"fmt"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// StartInterviewPrep is the use case. No LLM call here — parsing
// happened in a prior step (ParseCV / ParseJD).
type StartInterviewPrep struct {
	Preps domain.InterviewPrepRepo
}

// StartInterviewPrepInput carries the user id + already-parsed shapes.
// Raw text is stored alongside so a future re-parse (model upgrade)
// doesn't require the user to re-upload.
type StartInterviewPrepInput struct {
	UserID   uuid.UUID
	ParsedCV domain.ParsedCV
	ParsedJD domain.ParsedJD
	CVText   string
	JDText   string
}

// StartInterviewPrepResult carries the inserted row + the prep prompt
// block the caller might want to surface as a "what Cue will know"
// disclosure card.
type StartInterviewPrepResult struct {
	Prep          domain.InterviewPrep
	PromptPreview string
}

// Do is the entry point. Validates that AT LEAST ONE of CV / JD carries
// signal — saving an empty prep would just bloat the suggestion-injection
// path with a useless system block.
func (uc *StartInterviewPrep) Do(ctx context.Context, in StartInterviewPrepInput) (StartInterviewPrepResult, error) {
	if in.UserID == uuid.Nil {
		return StartInterviewPrepResult{}, fmt.Errorf("copilot.StartInterviewPrep: %w: user id required", domain.ErrInvalidInput)
	}
	if in.ParsedCV.IsEmpty() && in.ParsedJD.IsEmpty() {
		return StartInterviewPrepResult{}, fmt.Errorf("copilot.StartInterviewPrep: %w: at least one of CV / JD must carry signal", domain.ErrInvalidInput)
	}
	prep, err := uc.Preps.StartActive(ctx, in.UserID, in.ParsedCV, in.ParsedJD, in.CVText, in.JDText)
	if err != nil {
		return StartInterviewPrepResult{}, fmt.Errorf("copilot.StartInterviewPrep: %w", err)
	}
	return StartInterviewPrepResult{
		Prep:          prep,
		PromptPreview: domain.FormatInterviewPrepBlock(prep),
	}, nil
}
