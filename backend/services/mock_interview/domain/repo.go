package domain

import (
	"context"

	"github.com/google/uuid"
)

// CompanyRepo persists `companies` rows (extended fields only — base 00003
// columns may be set elsewhere).
type CompanyRepo interface {
	List(ctx context.Context, onlyActive bool) ([]Company, error)
	Get(ctx context.Context, id uuid.UUID) (Company, error)
	GetBySlug(ctx context.Context, slug string) (Company, error)
	Create(ctx context.Context, c Company) (Company, error)
	Update(ctx context.Context, c Company) (Company, error)
	SetActive(ctx context.Context, id uuid.UUID, active bool) error
}

// StrictnessRepo persists `ai_strictness_profiles` rows.
type StrictnessRepo interface {
	List(ctx context.Context, onlyActive bool) ([]AIStrictnessProfile, error)
	Get(ctx context.Context, id uuid.UUID) (AIStrictnessProfile, error)
	GetBySlug(ctx context.Context, slug string) (AIStrictnessProfile, error)
	Create(ctx context.Context, p AIStrictnessProfile) (AIStrictnessProfile, error)
	Update(ctx context.Context, p AIStrictnessProfile) (AIStrictnessProfile, error)
	SetActive(ctx context.Context, id uuid.UUID, active bool) error
}

// TaskFilter narrows TaskRepo.List output. Zero-values mean "any".
type TaskFilter struct {
	StageKind  StageKind
	Language   TaskLanguage
	OnlyActive bool
}

// TaskRepo persists `mock_tasks` rows.
type TaskRepo interface {
	List(ctx context.Context, f TaskFilter) ([]MockTask, error)
	Get(ctx context.Context, id uuid.UUID) (MockTask, error)
	Create(ctx context.Context, t MockTask) (MockTask, error)
	Update(ctx context.Context, t MockTask) (MockTask, error)
	SetActive(ctx context.Context, id uuid.UUID, active bool) error
	// PickRandom returns ONE random active task matching `stageKind`. If
	// `languagePool` is non-empty, only tasks whose language is in the pool
	// are considered. If `taskPoolIDs` is non-empty, the candidate set is
	// further restricted to those task IDs. Returns ErrNoTaskAvailable when
	// no candidate matches (so the orchestrator can convert it cleanly).
	PickRandom(ctx context.Context, stageKind StageKind,
		languagePool []TaskLanguage, taskPoolIDs []uuid.UUID) (MockTask, error)
}

// QuestionRepo bundles the three question tables — they share a payload
// shape and the admin UI tends to manipulate them in parallel.
type QuestionRepo interface {
	// Per-task follow-ups.
	ListTaskQuestions(ctx context.Context, taskID uuid.UUID) ([]TaskQuestion, error)
	CreateTaskQuestion(ctx context.Context, q TaskQuestion) (TaskQuestion, error)
	UpdateTaskQuestion(ctx context.Context, q TaskQuestion) (TaskQuestion, error)
	DeleteTaskQuestion(ctx context.Context, id uuid.UUID) error

	// Stage default pool.
	ListDefaultQuestions(ctx context.Context, stage StageKind, onlyActive bool) ([]DefaultQuestion, error)
	CreateDefaultQuestion(ctx context.Context, q DefaultQuestion) (DefaultQuestion, error)
	UpdateDefaultQuestion(ctx context.Context, q DefaultQuestion) (DefaultQuestion, error)
	DeleteDefaultQuestion(ctx context.Context, id uuid.UUID) error

	// Per-company overlay.
	ListCompanyQuestions(ctx context.Context, companyID uuid.UUID, stage StageKind) ([]CompanyQuestion, error)
	CreateCompanyQuestion(ctx context.Context, q CompanyQuestion) (CompanyQuestion, error)
	UpdateCompanyQuestion(ctx context.Context, q CompanyQuestion) (CompanyQuestion, error)
	DeleteCompanyQuestion(ctx context.Context, id uuid.UUID) error
}

// CompanyStageRepo persists `company_stages` (composite-PK config rows).
type CompanyStageRepo interface {
	GetForCompany(ctx context.Context, companyID uuid.UUID) ([]CompanyStage, error)
	Upsert(ctx context.Context, s CompanyStage) error
	Delete(ctx context.Context, companyID uuid.UUID, stage StageKind) error
	// ReplaceAll wipes existing rows for the company and writes the slice
	// transactionally — admin "save stage config" UX.
	ReplaceAll(ctx context.Context, companyID uuid.UUID, stages []CompanyStage) error
}

// PipelineRepo persists `mock_pipelines`.
type PipelineRepo interface {
	Create(ctx context.Context, p MockPipeline) (MockPipeline, error)
	Get(ctx context.Context, id uuid.UUID) (MockPipeline, error)
	ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]MockPipeline, error)
	UpdateVerdict(ctx context.Context, id uuid.UUID, verdict PipelineVerdict, totalScore *float32) error
	// IncrementStageIdx atomically bumps current_stage_idx by +1 and returns
	// the new value. Used by the orchestrator after FinishStage.
	IncrementStageIdx(ctx context.Context, id uuid.UUID) (int, error)
}

// PipelineStageRepo persists `pipeline_stages`.
type PipelineStageRepo interface {
	Create(ctx context.Context, s PipelineStage) (PipelineStage, error)
	Get(ctx context.Context, id uuid.UUID) (PipelineStage, error)
	ListByPipeline(ctx context.Context, pipelineID uuid.UUID) ([]PipelineStage, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status StageStatus) error
	// UpdateStartStage marks a stage in_progress + snapshots the strictness
	// profile id at start time. Idempotent on double-start (no-op if already
	// in_progress / finished — still returns nil).
	UpdateStartStage(ctx context.Context, id uuid.UUID, profileID uuid.UUID) error
	// FinishStage writes the aggregated score/verdict + ai_feedback_md and
	// flips status=finished + finished_at=now.
	FinishStage(ctx context.Context, id uuid.UUID, score float32, verdict StageVerdict, feedback string) error
}

// PipelineAttemptRepo persists `pipeline_attempts`.
type PipelineAttemptRepo interface {
	Create(ctx context.Context, a PipelineAttempt) (PipelineAttempt, error)
	Get(ctx context.Context, id uuid.UUID) (PipelineAttempt, error)
	ListByStage(ctx context.Context, pipelineStageID uuid.UUID) ([]PipelineAttempt, error)
	// UpdateJudgeResult overwrites the AI columns + ai_judged_at = now.
	UpdateJudgeResult(ctx context.Context, id uuid.UUID, userAnswerMD string,
		score float32, waterScore float32, verdict AttemptVerdict,
		feedback string, missingPoints []string) error
	// UpdateCanvasResult — Phase D.1 sysdesign-canvas writeback. Atomically
	// persists user-provided fields (image data URL + context_md +
	// non_functional_md collapsed into user_answer_md) and the judge's
	// score/verdict/feedback/missing_points + ai_judged_at = now.
	// Single UPDATE so a partial failure can't leave the attempt half-judged.
	UpdateCanvasResult(ctx context.Context, id uuid.UUID, in CanvasResultUpdate) error
	// GetWithQuestion returns a joined view: the attempt + the resolved
	// question body / expected_answer / reference_criteria for whichever of
	// the four FK columns is populated.
	GetWithQuestion(ctx context.Context, id uuid.UUID) (AttemptWithQuestion, error)
}

// CanvasResultUpdate — payload for PipelineAttemptRepo.UpdateCanvasResult.
// Sysdesign judge ставит water_score=0 (не применимо к диаграммам), верdict
// рассчитан в app-слое.
//
// SceneJSON is the raw Excalidraw scene blob (elements + files) which the
// frontend re-renders in viewMode when the user revisits the attempt. It
// supersedes the legacy ImageDataURL (kept for back-compat with rows
// written before F-3 v2 — new submissions leave that column NULL).
type CanvasResultUpdate struct {
	SceneJSON     []byte
	ContextMD     string
	UserAnswerMD  string // composed: "## Non-functional requirements\n\n{NonFunctionalMD}"
	Score         float32
	Verdict       AttemptVerdict
	Feedback      string
	MissingPoints []string
}

// AttemptWithQuestion is the read-projection used by SubmitAnswer to feed
// the LLM judge — the attempt plus its parent question/task content.
//
// TaskFunctionalRequirementsMD / TaskLanguage are only populated when the
// attempt is rooted on a `mock_tasks` row (Attempt.TaskID != nil) — for
// task_solve and sysdesign_canvas attempts. Empty otherwise.
type AttemptWithQuestion struct {
	Attempt                      PipelineAttempt
	QuestionBody                 string
	ExpectedAnswerMD             string
	ReferenceCriteria            ReferenceCriteria
	TaskFunctionalRequirementsMD string
	TaskLanguage                 string
}
