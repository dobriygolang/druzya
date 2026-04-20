// Package domain contains the entities, value objects and repository interfaces
// for the ai_mock bounded context. No external framework imports here.
//
// Security invariant — read before editing:
//   solution_hint lives ONLY in TaskWithHint (consumed by the LLM prompt builder).
//   Every client-facing shape (MockSessionView, MessageView, ReportView, …) MUST
//   NOT carry that field. Breaking this invariant is an information-leak bug.
package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Session is the persistent mock-interview state (one row in mock_sessions).
type Session struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	CompanyID     uuid.UUID
	TaskID        uuid.UUID
	Section       enums.Section
	Difficulty    enums.Difficulty
	Status        enums.MockStatus
	DurationMin   int
	VoiceMode     bool
	PairedUserID  *uuid.UUID
	LLMModel      enums.LLMModel
	DevilsAdvocate bool
	Stress        StressProfile
	Report        []byte // ai_report JSONB — nil until report job finishes
	ReplayURL     string
	StartedAt     *time.Time
	FinishedAt    *time.Time
	CreatedAt     time.Time
}

// Message is a persisted mock_messages row. Always roundtrip through the DB —
// the LLM itself is stateless (bible §8).
type Message struct {
	ID             uuid.UUID
	SessionID      uuid.UUID
	Role           enums.MessageRole
	Content        string
	CodeSnapshot   string
	StressSnapshot []byte
	TokensUsed     int
	CreatedAt      time.Time
}

// StressProfile is the rolling aggregation held in mock_sessions.stress_profile.
// Scoring heuristic — see service.StressScoring.
type StressProfile struct {
	PausesScore    int `json:"pauses_score"`
	BackspaceScore int `json:"backspace_score"`
	ChaosScore     int `json:"chaos_score"`
	PasteAttempts  int `json:"paste_attempts"`
}

// EditorEventType mirrors the openapi enum. Kept domain-local so the domain
// package has zero apigen dependency.
type EditorEventType string

const (
	EditorEventPause          EditorEventType = "pause"
	EditorEventBackspaceBurst EditorEventType = "backspace_burst"
	EditorEventChaoticEdit    EditorEventType = "chaotic_edit"
	EditorEventPasteAttempt   EditorEventType = "paste_attempt"
	EditorEventIdle           EditorEventType = "idle"
)

// IsValid supports exhaustive switches.
func (t EditorEventType) IsValid() bool {
	switch t {
	case EditorEventPause, EditorEventBackspaceBurst, EditorEventChaoticEdit,
		EditorEventPasteAttempt, EditorEventIdle:
		return true
	}
	return false
}

// EditorEvent is a single entry of a StressEventsBatch.
type EditorEvent struct {
	Type       EditorEventType
	AtMs       int64
	DurationMs int64
	Metadata   map[string]any
}

// TaskWithHint is the private LLM-input shape. solution_hint is embedded so the
// system-prompt builder can cite it to the interviewer-LLM. This struct MUST
// NEVER cross the HTTP/WS boundary.
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

// UserContext is the caller's profile slice needed by model selection.
// Kept minimal; the ai_mock domain MUST NOT import auth/profile.
type UserContext struct {
	ID                  uuid.UUID
	Subscription        enums.SubscriptionPlan
	PreferredModel      enums.LLMModel // empty => no preference
	ResponseLanguage    string         // "ru" / "en"; empty => "ru" default
}

// CompanyContext is what little the prompt builder needs about the target
// company. Real fetch happens in a profile/company repo wired at runtime;
// this struct stays within ai_mock.
type CompanyContext struct {
	ID    uuid.UUID
	Name  string
	Level string // "junior" | "middle" | "senior" | "staff" …
	// OverrideModel is set by the company profile (bible §8 — "company override").
	OverrideModel enums.LLMModel
}

// ReportDraft is the parsed LLM output stored in mock_sessions.ai_report.
// Shape mirrors apigen.MockReport — kept local so ports/server.go maps across.
type ReportDraft struct {
	OverallScore   int
	Sections       ReportSections
	Strengths      []string
	Weaknesses     []string
	Recommendations []ReportRecommendation
	StressAnalysis string
	ReplayURL      string
}

// ReportSections is the four-axis scorecard.
type ReportSections struct {
	ProblemSolving ScoredSection
	CodeQuality    ScoredSection
	Communication  ScoredSection
	StressHandling ScoredSection
}

// ScoredSection carries a score (0..100) + optional comment.
type ScoredSection struct {
	Score   int
	Comment string
}

// ReportRecommendation mirrors openapi Recommendation. Kept domain-local so
// ai_mock has no apigen dependency.
type ReportRecommendation struct {
	Title       string
	Description string
	ActionKind  string
	ActionRef   string
}

// StressSnapshot is a point-in-time value attached to an assistant message.
// Helps the UI render "the AI saw these stress levels when it answered".
type StressSnapshot = StressProfile
