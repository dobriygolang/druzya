// Package domain — mock_interview bounded context (Phase A of ADR-002).
//
// String-typed enums backed 1:1 by Postgres ENUM types defined in migration
// 00043. Keeping them as string aliases (rather than int constants) lets us
// scan/marshal directly to pgx without a converter layer.
package domain

// StageKind enumerates pipeline stage flavours. Mirrors the Postgres
// `mock_stage_kind` enum.
type StageKind string

const (
	StageHR         StageKind = "hr"
	StageAlgo       StageKind = "algo"
	StageCoding     StageKind = "coding"
	StageSysDesign  StageKind = "sysdesign"
	StageBehavioral StageKind = "behavioral"
	// StageMLCoding — ML coding stage (Phase K M3+M4 2026-05-12). Carries
	// same wire shape as StageCoding (task_solve attempt + optional
	// follow-up question_answers) and shares the algo/coding sandbox
	// runner, но routed to a separate judge prompt (ML-aware rubric:
	// correctness of math/algorithm choice + idiomaticity for numpy/
	// pandas/sklearn/torch + edge-case handling). Sandbox image MUST be
	// the custom Judge0 build with ML libs preinstalled — см.
	// infra/judge0/Dockerfile.ml-python. На стоковом Judge0 ml_coding
	// задачи будут падать «ModuleNotFoundError: numpy» — degradation
	// path: orchestrator detects sandbox-error and falls back to LLM-only
	// rubric grading via the same hybrid path as StageCoding.
	StageMLCoding StageKind = "ml_coding"
)

func (s StageKind) Valid() bool {
	switch s {
	case StageHR, StageAlgo, StageCoding, StageSysDesign, StageBehavioral, StageMLCoding:
		return true
	}
	return false
}

// TaskLanguage — language constraint for coding/algo tasks. Mirrors
// `mock_task_language` enum.
type TaskLanguage string

const (
	LangGo     TaskLanguage = "go"
	LangPython TaskLanguage = "python"
	LangSQL    TaskLanguage = "sql"
	LangAny    TaskLanguage = "any"
)

func (l TaskLanguage) Valid() bool {
	switch l {
	case LangGo, LangPython, LangSQL, LangAny:
		return true
	}
	return false
}

// PipelineVerdict — terminal/in-progress state of a pipeline. Mirrors
// `mock_pipeline_verdict` enum.
type PipelineVerdict string

const (
	PipelineInProgress PipelineVerdict = "in_progress"
	PipelinePass       PipelineVerdict = "pass"
	PipelineFail       PipelineVerdict = "fail"
	PipelineCancelled  PipelineVerdict = "cancelled"
)

// StageStatus — `pipeline_stage_status` enum.
type StageStatus string

const (
	StageStatusPending    StageStatus = "pending"
	StageStatusInProgress StageStatus = "in_progress"
	StageStatusFinished   StageStatus = "finished"
	StageStatusSkipped    StageStatus = "skipped"
)

// StageVerdict — `pipeline_stage_verdict` enum.
type StageVerdict string

const (
	StageVerdictPass       StageVerdict = "pass"
	StageVerdictFail       StageVerdict = "fail"
	StageVerdictBorderline StageVerdict = "borderline"
)

// AttemptKind — `pipeline_attempt_kind` enum.
type AttemptKind string

const (
	AttemptTaskSolve       AttemptKind = "task_solve"
	AttemptQuestionAnswer  AttemptKind = "question_answer"
	AttemptSysDesignCanvas AttemptKind = "sysdesign_canvas"
	AttemptVoiceAnswer     AttemptKind = "voice_answer"
)

// AttemptVerdict — `pipeline_attempt_verdict` enum.
type AttemptVerdict string

const (
	AttemptVerdictPass       AttemptVerdict = "pass"
	AttemptVerdictFail       AttemptVerdict = "fail"
	AttemptVerdictBorderline AttemptVerdict = "borderline"
	AttemptVerdictPending    AttemptVerdict = "pending"
)
