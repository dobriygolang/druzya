//go:generate mockgen -package mocks -destination mocks/writing_mock.go -source writing.go
package domain

import "context"

// Writing sub-context. Writing-as-Focus: the user drafts an English
// paragraph / short essay
// and asks the AI to surface concrete issues with concrete fixes. No
// persistence layer in this slice — text lives in the renderer until
// the user copies it into a Note. The backend only owns the grading
// pipeline.
//
// Why a separate domain file (vs piggy-backing on reading.go):
// Reading is library + sessions + SRS — three persisted entities tied
// to chapters. Writing is a stateless evaluation. Mixing the two would
// force every Reading caller to think about Writing types and vice
// versa. Cheap to keep them apart.

// WritingIssueCategory enumerates the kinds of feedback the grader can
// emit. Mirrors the JSON enum in writingFeedbackPrompt — additions
// here MUST also extend the prompt's allowed-values list.
type WritingIssueCategory string

const (
	WritingIssueGrammar WritingIssueCategory = "grammar"
	WritingIssueVocab   WritingIssueCategory = "vocab"
	WritingIssueStyle   WritingIssueCategory = "style"
	WritingIssueClarity WritingIssueCategory = "clarity"
)

// IsValid keeps switches downstream exhaustive. Unknown categories
// from the LLM are coerced to "style" by the parser — we never crash
// the user-facing flow on a model hallucination.
func (c WritingIssueCategory) IsValid() bool {
	switch c {
	case WritingIssueGrammar, WritingIssueVocab, WritingIssueStyle, WritingIssueClarity:
		return true
	}
	return false
}

// WritingIssue is one concrete finding. Excerpt is the user's exact
// text the issue applies to (verbatim slice — frontend can highlight
// it by indexOf-search rather than carrying brittle char-offsets across
// JSON serialisation). Suggestion is the model's proposed fix.
type WritingIssue struct {
	Excerpt    string
	Category   WritingIssueCategory
	Suggestion string
	// Explanation is a short why — surfaced on hover / expand. Kept
	// short to keep token budgets reasonable.
	Explanation string
}

// WritingFeedback is what the grader returns. Empty `Issues` means
// «nothing flagged» — a valid result, not an error. OverallScore is
// 0..100 mirroring the summary grader's scale; useful for showing a
// «B+» / «needs work» chip without re-running the model.
type WritingFeedback struct {
	OverallScore int
	Issues       []WritingIssue
}

// GradeWritingInput carries everything the grader needs. Title is
// optional — when present, the grader can scope its feedback to the
// declared topic (off-topic is then a clarity/style issue).
type GradeWritingInput struct {
	Title string
	Text  string
}

// WritingGrader evaluates a user-written piece of English and returns
// concrete actionable feedback. Implementations are LLM-backed; the
// floor adapter returns ErrLLMUnavailable when no provider is wired.
type WritingGrader interface {
	GradeWriting(ctx context.Context, in GradeWritingInput) (WritingFeedback, error)
}
