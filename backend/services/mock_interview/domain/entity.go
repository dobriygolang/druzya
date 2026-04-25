// Package domain — entities for the mock interview pipeline.
//
// Field-naming follows the Postgres column names 1:1 — repos and ports map
// camelCase JSON / proto on top. Pointer fields denote NULL-able columns.
package domain

import (
	"time"

	"github.com/google/uuid"
)

// ReferenceCriteria is the typed shape we enforce for the JSONB
// `reference_criteria` column on mock_tasks / task_questions / etc.
//
// The AI judge (Phase B) reads this deterministically — we keep the shape
// closed so admin payloads can't smuggle unexpected keys.
type ReferenceCriteria struct {
	MustMention    []string `json:"must_mention"`
	NiceToHave     []string `json:"nice_to_have"`
	CommonPitfalls []string `json:"common_pitfalls"`
}

// Company — extended view of `companies` (00003 base + 00043 columns).
// Legacy 00003 columns (difficulty, min_level_required, sections) are
// passed through verbatim; new feature columns sit alongside.
type Company struct {
	ID               uuid.UUID
	Slug             string
	Name             string
	Difficulty       string
	MinLevelRequired int
	Sections         []string
	LogoURL          string // empty ⇢ NULL
	Description      string
	Active           bool
	SortOrder        int
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// AIStrictnessProfile — admin-tunable judge config row.
type AIStrictnessProfile struct {
	ID                   uuid.UUID
	Slug                 string
	Name                 string
	OffTopicPenalty      float32
	MustMentionPenalty   float32
	HallucinationPenalty float32
	BiasTowardFail       bool
	CustomPromptTemplate string // empty ⇢ NULL
	Active               bool
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// MockTask — algo / coding / sysdesign task row.
type MockTask struct {
	ID                       uuid.UUID
	StageKind                StageKind
	Language                 TaskLanguage
	Difficulty               int
	Title                    string
	BodyMD                   string
	SampleIOMD               string
	ReferenceCriteria        ReferenceCriteria
	ReferenceSolutionMD      string
	FunctionalRequirementsMD string
	TimeLimitMin             int
	AIStrictnessProfileID    *uuid.UUID
	// LLMModel — per-task override matching llm_models.model_id. Empty
	// means inherit from strictness profile / global default. Validated
	// on write only at the catalogue layer; the chain treats unknown
	// ids as "fall through".
	LLMModel         string
	Active           bool
	CreatedByAdminID *uuid.UUID
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// TaskQuestion — interviewer follow-up tied to a single task.
type TaskQuestion struct {
	ID                uuid.UUID
	TaskID            uuid.UUID
	Body              string
	ExpectedAnswerMD  string
	ReferenceCriteria ReferenceCriteria
	SortOrder         int
	CreatedAt         time.Time
}

// DefaultQuestion — global HR/behavioral pool row (`stage_default_questions`).
type DefaultQuestion struct {
	ID                uuid.UUID
	StageKind         StageKind
	Body              string
	ExpectedAnswerMD  string
	ReferenceCriteria ReferenceCriteria
	Active            bool
	SortOrder         int
	CreatedAt         time.Time
}

// CompanyQuestion — per-company HR/behavioral overlay row.
type CompanyQuestion struct {
	ID                uuid.UUID
	CompanyID         uuid.UUID
	StageKind         StageKind
	Body              string
	ExpectedAnswerMD  string
	ReferenceCriteria ReferenceCriteria
	Active            bool
	SortOrder         int
	CreatedAt         time.Time
}

// CompanyStage — config row describing which stages a company runs and
// in what order.
type CompanyStage struct {
	CompanyID             uuid.UUID
	StageKind             StageKind
	Ordinal               int
	Optional              bool
	LanguagePool          []TaskLanguage
	TaskPoolIDs           []uuid.UUID
	AIStrictnessProfileID *uuid.UUID
}

// MockPipeline — one user attempt. Phase A creates the row + skeleton;
// Phase B's orchestrator advances it.
type MockPipeline struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	CompanyID       *uuid.UUID
	AIAssist        bool
	CurrentStageIdx int
	Verdict         PipelineVerdict
	TotalScore      *float32
	StartedAt       time.Time
	FinishedAt      *time.Time
}

// PipelineStage — one stage instance in a pipeline.
type PipelineStage struct {
	ID                    uuid.UUID
	PipelineID            uuid.UUID
	StageKind             StageKind
	Ordinal               int
	Status                StageStatus
	Score                 *float32
	Verdict               *StageVerdict
	AIFeedbackMD          string
	AIStrictnessProfileID *uuid.UUID
	StartedAt             *time.Time
	FinishedAt            *time.Time
}

// PipelineAttempt — one task-solve / question-answer event under a stage.
type PipelineAttempt struct {
	ID                      uuid.UUID
	PipelineStageID         uuid.UUID
	Kind                    AttemptKind
	TaskID                  *uuid.UUID
	TaskQuestionID          *uuid.UUID
	DefaultQuestionID       *uuid.UUID
	CompanyQuestionID       *uuid.UUID
	UserAnswerMD            string
	UserVoiceURL            string
	UserExcalidrawImageURL  string // legacy: pre-F-3 v2 inline data URL
	UserExcalidrawSceneJSON []byte // F-3 v2: Excalidraw scene blob (jsonb)
	UserContextMD           string
	AIScore                 *float32
	AIVerdict               AttemptVerdict
	AIFeedbackMD            string
	AIWaterScore            *float32
	AIMissingPoints         []string
	AIJudgedAt              *time.Time
	CreatedAt               time.Time
}
