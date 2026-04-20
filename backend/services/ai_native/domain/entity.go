package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Session is the persistent state of an AI-Native Round (one row in
// native_sessions). Scores are kept inline so the hot-path reads avoid a
// second table.
type Session struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	TaskID     uuid.UUID
	Section    enums.Section
	Difficulty enums.Difficulty
	LLMModel   enums.LLMModel
	Scores     Scores
	StartedAt  time.Time
	FinishedAt *time.Time
}

// IsFinished reports whether the round has already been finalised.
func (s Session) IsFinished() bool { return s.FinishedAt != nil }

// Scores is the four-axis rubric (bible §19.1).
//
// Each axis is clamped 0..100 and stored directly on native_sessions.
type Scores struct {
	Context      int // quality of prompts to AI
	Verification int // whether the user checks AI answers
	Judgment     int // whether the user catches hallucinations
	Delivery     int // final result quality
}

// ProvenanceRecord mirrors one row in native_provenance. Each record tracks a
// single chunk of code and its origin (ai_generated / human_written /
// ai_revised_by_human / ai_rejected).
type ProvenanceRecord struct {
	ID                   uuid.UUID
	SessionID            uuid.UUID
	ParentID             *uuid.UUID
	Kind                 enums.ProvenanceKind
	Snippet              string
	AIPrompt             string
	HasHallucinationTrap bool
	VerifiedAt           *time.Time
	CreatedAt            time.Time
}

// HallucinationTrap is a curated plausible-wrong answer that the system may
// substitute for a real LLM response. Catching / rejecting the trap raises
// the user's Judgment score; silently accepting it is penalised.
//
// STUB: the MVP keeps the catalog hardcoded in infra/traps.go. A future
// migration will promote traps to a CMS table.
type HallucinationTrap struct {
	ID             string        // stable slug, e.g. "sql-forget-where"
	Category       enums.Section // section the trap applies to
	PromptPattern  string        // lower-case substring to match on user prompt
	WrongAnswer    string        // what the LLM "says" when the trap fires
	CorrectAnswer  string        // the benign truthful answer (for grading / post-hoc UI)
	Rationale      string        // short explanation shown post-session
}

// UserAction is an interaction a user may have with a provenance record.
// Feeds ComputeScores.
type UserAction struct {
	ProvenanceID uuid.UUID
	Action       ActionKind
	TargetTrap   bool // true if the record carried a hallucination trap
}

// ActionKind enumerates the three verify-step outcomes (mirrors
// apigen.NativeVerifyRequestAction).
type ActionKind string

const (
	ActionAccepted ActionKind = "accepted"
	ActionRejected ActionKind = "rejected"
	ActionRevised  ActionKind = "revised"
)

// IsValid supports exhaustive switches.
func (a ActionKind) IsValid() bool {
	switch a {
	case ActionAccepted, ActionRejected, ActionRevised:
		return true
	}
	return false
}

// UserContext is the caller's profile slice needed by model selection.
// Kept minimal; ai_native MUST NOT import auth/profile.
type UserContext struct {
	ID               uuid.UUID
	Subscription     enums.SubscriptionPlan
	PreferredModel   enums.LLMModel // empty => no preference
	ResponseLanguage string         // "ru" / "en"; empty => "ru" default
}

// TaskWithHint is the LLM-internal shape. solution_hint is embedded so the
// grader prompt can use it; this struct MUST NEVER cross the HTTP boundary.
type TaskWithHint struct {
	ID           uuid.UUID
	Slug         string
	Title        string
	Description  string
	Difficulty   enums.Difficulty
	Section      enums.Section
	SolutionHint string // CRITICAL: private, LLM-only.
}

// TaskPublic is the client-safe projection (no solution_hint).
type TaskPublic struct {
	ID          uuid.UUID
	Slug        string
	Title       string
	Description string
	Difficulty  enums.Difficulty
	Section     enums.Section
}

// ToPublic strips the hint. Always call this before returning a task over HTTP.
func (t TaskWithHint) ToPublic() TaskPublic {
	return TaskPublic{
		ID:          t.ID,
		Slug:        t.Slug,
		Title:       t.Title,
		Description: t.Description,
		Difficulty:  t.Difficulty,
		Section:     t.Section,
	}
}
