package domain

import "context"

// Code review sub-context — Wave 3.6 of docs/feature/plan.md
// (Code-review-coaching). Stateless evaluation, parallel to the Writing
// surface (Wave 4.4): user pastes a unified diff + writes their review,
// we grade the review across four axes. No persistence layer.
//
// Why a separate domain file (vs reusing WritingGrader):
// the rubric is fundamentally different — Writing scores fluency,
// Code Review scores technical accuracy. Sharing the type would push
// surface-aware branching into every reader.

// CodeReviewIssueCategory enumerates the kinds of feedback the grader
// can emit for a code review. Mirrors the JSON enum locked into the
// reviewFeedbackPrompt — extending it requires updating both.
type CodeReviewIssueCategory string

const (
	// Correctness — review says something is broken / unsafe / wrong.
	// We flag if the claim doesn't actually hold against the diff.
	ReviewIssueCorrectness CodeReviewIssueCategory = "correctness"
	// Completeness — review missed an obvious problem the diff has.
	ReviewIssueCompleteness CodeReviewIssueCategory = "completeness"
	// Clarity — comment is technically right but unclear or hand-wavy.
	ReviewIssueClarity CodeReviewIssueCategory = "clarity"
	// Tone — comment is needlessly hostile / patronising / blame-y.
	ReviewIssueTone CodeReviewIssueCategory = "tone"
)

// IsValid keeps switches downstream exhaustive. Unknown categories
// from the LLM are coerced to "clarity" by the parser (sanitisation).
func (c CodeReviewIssueCategory) IsValid() bool {
	switch c {
	case ReviewIssueCorrectness, ReviewIssueCompleteness, ReviewIssueClarity, ReviewIssueTone:
		return true
	}
	return false
}

// CodeReviewIssue is one concrete finding. Excerpt is verbatim from the
// user's review (or empty if the issue is «something the review missed»
// — completeness category). Suggestion is the model's proposed
// rephrase or addition.
type CodeReviewIssue struct {
	// Verbatim slice from the user's review the issue applies to.
	// May be empty for completeness issues («reviewer didn't mention X»).
	Excerpt     string
	Category    CodeReviewIssueCategory
	Suggestion  string
	Explanation string
}

// CodeReviewFeedback is what the grader returns. Empty Issues = «good
// review» (rare but valid). OverallScore is 0..100 — same scale as the
// other graders so the UI can reuse strong/mid/weak chip styling.
type CodeReviewFeedback struct {
	OverallScore int
	Issues       []CodeReviewIssue
}

// GradeCodeReviewInput carries everything the grader needs. DiffMD is
// the unified diff (plain text, not parsed); ReviewMD is the user's
// write-up. PRTitle is optional context — when present the grader can
// reason about whether the review is on-topic.
type GradeCodeReviewInput struct {
	PRTitle  string
	DiffMD   string
	ReviewMD string
}

// CodeReviewGrader evaluates a user-written review against a diff.
// Implementations are LLM-backed; the floor adapter returns
// ErrLLMUnavailable when no provider is wired.
type CodeReviewGrader interface {
	GradeReview(ctx context.Context, in GradeCodeReviewInput) (CodeReviewFeedback, error)
}
