// Package domain holds the pure entities + repo contracts for the
// intelligence (AI-coach) bounded context. No framework imports.
package domain

import (
	"time"

	"github.com/google/uuid"
)

// RecommendationKind classifies what a recommendation chip does on click
// (mirrors druz9.v1.RecommendationKind on the wire).
type RecommendationKind string

const (
	// RecommendationTinyTask — small concrete action; UI pins as Focus title.
	RecommendationTinyTask RecommendationKind = "tiny_task"
	// RecommendationSchedule — timing advice; UI shows as tooltip-only.
	RecommendationSchedule RecommendationKind = "schedule"
	// RecommendationReviewNote — open Notes with target_id = note_id.
	RecommendationReviewNote RecommendationKind = "review_note"
	// RecommendationUnblock — open Today with target_id = plan_item_id highlighted.
	RecommendationUnblock RecommendationKind = "unblock"
)

// IsValid returns true for known kinds.
func (k RecommendationKind) IsValid() bool {
	switch k {
	case RecommendationTinyTask, RecommendationSchedule, RecommendationReviewNote, RecommendationUnblock:
		return true
	}
	return false
}

// Recommendation is one actionable item in a DailyBrief.
type Recommendation struct {
	Kind      RecommendationKind
	Title     string
	Rationale string
	// TargetID is optional. note_id for ReviewNote, plan_item_id for
	// Unblock, empty otherwise.
	TargetID string
}

// DailyBrief is the synthesised morning brief.
type DailyBrief struct {
	// BriefID — UUID для AckRecommendation. Phase A briefs (без memory)
	// имеют BriefID = uuid.Nil; client'у через proto придёт пустая строка.
	BriefID         uuid.UUID
	Headline        string
	Narrative       string
	Recommendations []Recommendation
	GeneratedAt     time.Time
}

// Citation is one note referenced by [N] in AskAnswer.AnswerMD.
type Citation struct {
	NoteID  uuid.UUID
	Title   string
	Snippet string
}

// AskAnswer is the LLM response + structured citations.
type AskAnswer struct {
	AnswerMD  string
	Citations []Citation
}

// ─── Reader projections (read-only views over hone-domain tables) ─────────

// FocusDay is one day's focus aggregate (mirror of hone domain.StreakDay,
// kept here so we don't import hone's domain).
type FocusDay struct {
	Day       time.Time
	Seconds   int
	Pomodoros int
}

// SkippedPlanItem is a plan item that was dismissed by the user.
type SkippedPlanItem struct {
	ItemID   string
	Title    string
	SkillKey string
	PlanDate time.Time
}

// CompletedPlanItem is a plan item that was completed by the user.
type CompletedPlanItem struct {
	ItemID   string
	Title    string
	SkillKey string
	PlanDate time.Time
}

// Reflection is one EndFocusSession reflection-line, surfaced via the
// reflection-note convention (note title contains " — YYYY-MM-DD" and
// body starts with the user's text).
type Reflection struct {
	NoteID    uuid.UUID
	Title     string
	BodyHead  string // first ~200 chars of body, before the divider
	CreatedAt time.Time
}

// NoteHead is a recently-touched note's head used for prompt seeding.
type NoteHead struct {
	NoteID    uuid.UUID
	Title     string
	Excerpt   string // first ~200 chars of body_md
	UpdatedAt time.Time
}

// NoteEmbedding mirrors hone.domain.NoteEmbedding for AskNotes top-K.
type NoteEmbedding struct {
	NoteID    uuid.UUID
	Title     string
	Body      string // full body_md (capped by reader to ~2KB) for the QA prompt
	Snippet   string // short snippet for citation hover
	Embedding []float32
}
