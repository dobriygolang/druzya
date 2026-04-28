// Package domain — quiz domain types: Question, Session, Result.
//
// Quiz unifies three question pools so the user has one place to test
// recall:
//   - codex_articles.quiz_question/answer  (source = codex)
//   - mock_pipeline question banks         (source = mock)
//   - mixed                                 (random across both)
//
// A Session is short-lived (30 min TTL in Redis) — no Postgres footprint.
// On Submit, hone listens for quiz.SessionCompleted to settle a TaskBoard
// `kind=quiz` card.
package domain

import (
	"time"

	"github.com/google/uuid"
)

// QuestionSource describes where the question came from. Used in the bus
// event payload so coach_listener can route to the right `kind=quiz` task.
type QuestionSource string

const (
	SourceCodex QuestionSource = "codex"
	SourceMock  QuestionSource = "mock_interview"
	SourceMixed QuestionSource = "mixed"
)

// IsValid reports whether the source is one of the canonical values.
func (s QuestionSource) IsValid() bool {
	switch s {
	case SourceCodex, SourceMock, SourceMixed:
		return true
	}
	return false
}

// Question — one immutable quiz question.
type Question struct {
	ID             string         // stable id (codex slug or mock_task uuid as string)
	Source         QuestionSource // single-pool source even when session is mixed
	Topic          string         // codex.category or mock_task section
	QuestionMD     string         // shown to the user
	ExpectedAnswer string         // ground truth — never sent to the client
	AnswerHint     string         // optional helper sent to the client
	ReadingLink    string         // for codex: "/codex/<slug>"; empty for mock
}

// Session — one quiz attempt. Lives in Redis with TTL.
type Session struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Source    QuestionSource
	Questions []Question
	StartedAt time.Time
	ExpiresAt time.Time
}

// AnswerJudgement — grading result for one (question, given_answer) pair.
type AnswerJudgement struct {
	QuestionID  string
	GivenAnswer string
	Correct     bool
	Explanation string // 1-2 sentence rationale from the LLM grader
}

// Result — aggregate of one Session's grading.
type Result struct {
	SessionID  uuid.UUID
	UserID     uuid.UUID
	Source     QuestionSource
	Total      int
	Correct    int
	Judgements []AnswerJudgement
}
