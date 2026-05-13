// Package app — code-review-coaching use case: validates input, hands off
// to the grader, returns structured feedback. No persistence — the diff
// + review live in the renderer; user keeps a permanent copy via
// Save-to-Notes if they want.
package app

import (
	"context"
	"fmt"
	"strings"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// GradeCodeReview wraps a domain.CodeReviewGrader. UserID is for
// attribution / future quotas; we don't use it for auth gating since
// the grader is request-scoped and stateless.
type GradeCodeReview struct {
	Grader domain.CodeReviewGrader
}

// GradeCodeReviewInput. Same shape as the domain input plus UserID for
// attribution.
type GradeCodeReviewInput struct {
	UserID   uuid.UUID
	PRTitle  string
	DiffMD   string
	ReviewMD string
}

// Caps mirror the LLM adapter's input thresholds — past these the
// quality-vs-latency tradeoff stops paying off.
const (
	codeReviewDiffMax   = 100_000 // ~2.5k lines
	codeReviewReviewMax = 20_000  // ~3.5k words
)

func (uc *GradeCodeReview) Do(ctx context.Context, in GradeCodeReviewInput) (domain.CodeReviewFeedback, error) {
	if uc.Grader == nil {
		return domain.CodeReviewFeedback{}, fmt.Errorf("hone.GradeCodeReview: grader not wired")
	}
	if in.UserID == uuid.Nil {
		return domain.CodeReviewFeedback{}, fmt.Errorf("hone.GradeCodeReview: user_id required")
	}
	diff := strings.TrimSpace(in.DiffMD)
	if diff == "" {
		return domain.CodeReviewFeedback{}, fmt.Errorf("hone.GradeCodeReview: diff required")
	}
	if len(diff) > codeReviewDiffMax {
		return domain.CodeReviewFeedback{}, fmt.Errorf("hone.GradeCodeReview: diff too large (>%d)", codeReviewDiffMax)
	}
	review := strings.TrimSpace(in.ReviewMD)
	if review == "" {
		return domain.CodeReviewFeedback{}, fmt.Errorf("hone.GradeCodeReview: review required")
	}
	if len(review) > codeReviewReviewMax {
		return domain.CodeReviewFeedback{}, fmt.Errorf("hone.GradeCodeReview: review too large (>%d)", codeReviewReviewMax)
	}
	out, err := uc.Grader.GradeReview(ctx, domain.GradeCodeReviewInput{
		PRTitle:  strings.TrimSpace(in.PRTitle),
		DiffMD:   diff,
		ReviewMD: review,
	})
	if err != nil {
		return domain.CodeReviewFeedback{}, fmt.Errorf("hone.GradeCodeReview: %w", err)
	}
	return out, nil
}
