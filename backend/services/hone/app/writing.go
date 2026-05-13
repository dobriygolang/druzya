// Package app — Writing-as-Focus AI feedback use case. Single thin
// orchestrator: validates input, hands off to the grader. No persistence —
// feedback is request-scoped; the user copies the piece into a Note if
// they want to keep it.
package app

import (
	"context"
	"fmt"
	"strings"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// GradeEnglishWriting wraps a domain.WritingGrader. Caller (Connect
// handler) supplies the authenticated user id even though we don't
// persist anything — surfaces are rate-limited per-user and we want
// the audit trail (logs + future quotas) to attribute calls correctly.
type GradeEnglishWriting struct {
	Grader domain.WritingGrader
}

// GradeEnglishWritingInput — keep it small. Title is optional context
// for the grader; UserID is for attribution.
type GradeEnglishWritingInput struct {
	UserID uuid.UUID
	Title  string
	Text   string
}

// Do validates and grades. The 50_000-char cap matches the reasonable
// upper bound for a Writing-as-Focus session (a 25-min focus block
// rarely produces > 8000 words). Past that we don't even try.
func (uc *GradeEnglishWriting) Do(ctx context.Context, in GradeEnglishWritingInput) (domain.WritingFeedback, error) {
	if uc.Grader == nil {
		return domain.WritingFeedback{}, fmt.Errorf("hone.GradeEnglishWriting: grader not wired")
	}
	if in.UserID == uuid.Nil {
		return domain.WritingFeedback{}, fmt.Errorf("hone.GradeEnglishWriting: user_id required")
	}
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return domain.WritingFeedback{}, fmt.Errorf("hone.GradeEnglishWriting: text required")
	}
	if len(text) > 50_000 {
		return domain.WritingFeedback{}, fmt.Errorf("hone.GradeEnglishWriting: text too large (>50KB)")
	}
	out, err := uc.Grader.GradeWriting(ctx, domain.GradeWritingInput{
		Title: strings.TrimSpace(in.Title),
		Text:  text,
	})
	if err != nil {
		return domain.WritingFeedback{}, fmt.Errorf("hone.GradeEnglishWriting: %w", err)
	}
	return out, nil
}
