// Package app — orchestrator.go: drives a pipeline through its stages.
//
// Lifecycle:
//
//	StartNextStage    — flip first pending stage to in_progress, materialise
//	                    HR attempts, snapshot strictness profile.
//	SubmitAnswer      — run the LLM judge against an attempt, persist.
//	FinishStage       — aggregate attempt scores → stage verdict; bump
//	                    pipeline.current_stage_idx; if last, FinishPipeline.
//	FinishPipeline    — aggregate stages → pipeline verdict + total_score.
//	CancelPipeline    — owner-only kill switch.
//
// Phase B.1 ships only the HR (question_answer) materialiser; Phase C/D/E
// add the algo / coding / sysdesign / behavioral orchestrators.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/mock_interview/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// StrictnessResolver is the seam used by the orchestrator to snapshot the
// effective profile per stage. *Handlers (this package) implements it via
// ResolveStrictness; we keep it as an interface so Orchestrator tests can
// inject a stub without dragging the whole Handlers fakeset.
type StrictnessResolver interface {
	ResolveStrictness(ctx context.Context, taskID uuid.UUID, companyID *uuid.UUID, stage domain.StageKind) (domain.AIStrictnessProfile, error)
}

// Orchestrator wires every dependency the multi-step state machine needs.
//
// All fields are required EXCEPT Log (nil-safe). Now is mockable for tests
// (defaults to time.Now if zero-valued).
type Orchestrator struct {
	Pipelines      domain.PipelineRepo
	PipelineStages domain.PipelineStageRepo
	Attempts       domain.PipelineAttemptRepo
	Questions      domain.QuestionRepo
	Tasks          domain.TaskRepo
	CompanyStages  domain.CompanyStageRepo
	Strictness     StrictnessResolver
	Judge          JudgeClient
	// Sandbox runs task_solve attempts through Judge0. May be nil — when so
	// (or when .Available() is false / language unsupported / no test cases)
	// we fall back to the LLM code-review judge.
	Sandbox domain.SandboxExecutor
	// CanvasDrafts is the optional Redis fallback for the sysdesign canvas
	// autosave (frontend writes here only when the browser localStorage
	// quota is exhausted). May be nil — handlers tolerate that with a 503.
	CanvasDrafts domain.CanvasDraftStore
	// Memory is an optional tap into the Coach episode store. nil-safe.
	// FinishPipeline emits a `mock_pipeline_finished` episode so future
	// Daily Briefs reference past sessions ("неделю назад sysdesign 32,
	// сегодня 71 — рост"). Failures don't block the user's submit.
	Memory domain.MemoryHook
	// Skills is the optional atlas-progress writer. nil-safe.
	// FinishPipeline maps each stage's verdict+score to the matching
	// atlas node_key and upserts progress (UpsertSkillNode uses GREATEST
	// → no regression). Without this nothing on the user's atlas moves
	// when they finish a mock.
	Skills domain.SkillNodeWriter
	Now    func() time.Time
	Log    *slog.Logger
}

func (o *Orchestrator) now() time.Time {
	if o.Now != nil {
		return o.Now().UTC()
	}
	return time.Now().UTC()
}

// AttemptView is the read-projection returned alongside each stage —
// includes the resolved question body so the frontend doesn't need a second
// fetch.
type AttemptView struct {
	Attempt           domain.PipelineAttempt
	QuestionBody      string
	ExpectedAnswerMD  string
	ReferenceCriteria domain.ReferenceCriteria
	// TaskFunctionalRequirementsMD / TaskLanguage are populated when the
	// attempt is rooted on a mock_tasks row (TaskID != nil). Empty otherwise.
	TaskFunctionalRequirementsMD string
	TaskLanguage                 string
}

// StageWithAttempts — joined view used by StartNextStage + GetPipelineFull.
type StageWithAttempts struct {
	Stage    domain.PipelineStage
	Attempts []AttemptView
}

// ── StartNextStage ──────────────────────────────────────────────────────

// StartNextStage flips the first pending stage to in_progress, snapshots
// strictness, and (for HR-kind) materialises one pipeline_attempt per
// default + company question.
func (o *Orchestrator) StartNextStage(ctx context.Context, pipelineID uuid.UUID) (StageWithAttempts, error) {
	pipe, err := o.Pipelines.Get(ctx, pipelineID)
	if err != nil {
		return StageWithAttempts{}, fmt.Errorf("pipelines.Get: %w", err)
	}
	if pipe.Verdict != domain.PipelineInProgress {
		return StageWithAttempts{}, fmt.Errorf("pipeline not in_progress (verdict=%s): %w", pipe.Verdict, domain.ErrConflict)
	}

	stages, err := o.PipelineStages.ListByPipeline(ctx, pipelineID)
	if err != nil {
		return StageWithAttempts{}, fmt.Errorf("pipelineStages.ListByPipeline: %w", err)
	}
	var stage domain.PipelineStage
	found := false
	for _, s := range stages {
		if s.Status == domain.StageStatusPending {
			stage = s
			found = true
			break
		}
	}
	if !found {
		return StageWithAttempts{}, fmt.Errorf("no pending stage: %w", domain.ErrConflict)
	}

	// Snapshot the strictness profile for THIS stage (no taskID for HR).
	profile, err := o.Strictness.ResolveStrictness(ctx, uuid.Nil, pipe.CompanyID, stage.StageKind)
	if err != nil {
		return StageWithAttempts{}, fmt.Errorf("resolve strictness: %w", err)
	}
	if uerr := o.PipelineStages.UpdateStartStage(ctx, stage.ID, profile.ID); uerr != nil {
		return StageWithAttempts{}, fmt.Errorf("pipelineStages.UpdateStartStage: %w", uerr)
	}
	stage.Status = domain.StageStatusInProgress
	t := o.now()
	stage.StartedAt = &t
	stage.AIStrictnessProfileID = &profile.ID

	// Per-stage materialisation. HR is Phase B; algo/coding is Phase C.
	// behavioral / sysdesign are Phase D/E — keep the stub (no attempts).
	var attempts []AttemptView
	switch stage.StageKind {
	case domain.StageHR, domain.StageBehavioral:
		// HR + behavioral share the question-pool shape: one pipeline_attempt
		// per default + (optional) company-overlay question. Judge prompt
		// branches on StageKind for STAR-rubric (behavioral) vs general
		// (HR) — see judge.go pass-2 prompt selector.
		attempts, err = o.materialiseQuestionAttempts(ctx, stage.ID, stage.StageKind, pipe.CompanyID)
		if err != nil {
			return StageWithAttempts{}, fmt.Errorf("materialise %s attempts: %w", stage.StageKind, err)
		}
	case domain.StageAlgo, domain.StageCoding:
		attempts, err = o.materialiseTaskAttempts(ctx, stage, pipe)
		if err != nil {
			return StageWithAttempts{}, fmt.Errorf("materialise task attempts: %w", err)
		}
	case domain.StageSysDesign:
		attempts, err = o.materialiseSysDesignAttempts(ctx, stage, pipe)
		if err != nil {
			return StageWithAttempts{}, fmt.Errorf("materialise sysdesign attempts: %w", err)
		}
	}

	return StageWithAttempts{Stage: stage, Attempts: attempts}, nil
}

// pickTaskForStage selects a task for the given stage. Picks based on
// company_stage config (task_pool_ids / language_pool); falls back to "any
// active task for the stage_kind" when no company is set / no config row.
func (o *Orchestrator) pickTaskForStage(
	ctx context.Context,
	stage domain.PipelineStage,
	pipeline domain.MockPipeline,
) (domain.MockTask, error) {
	if o.Tasks == nil {
		return domain.MockTask{}, fmt.Errorf("orchestrator.Tasks not wired: %w", domain.ErrNoTaskAvailable)
	}
	var (
		languagePool []domain.TaskLanguage
		taskPoolIDs  []uuid.UUID
	)
	if pipeline.CompanyID != nil && *pipeline.CompanyID != uuid.Nil && o.CompanyStages != nil {
		cfgs, err := o.CompanyStages.GetForCompany(ctx, *pipeline.CompanyID)
		if err == nil {
			for _, c := range cfgs {
				if c.StageKind == stage.StageKind {
					languagePool = c.LanguagePool
					taskPoolIDs = c.TaskPoolIDs
					break
				}
			}
		}
	}
	task, err := o.Tasks.PickRandom(ctx, stage.StageKind, languagePool, taskPoolIDs)
	if err != nil {
		return domain.MockTask{}, fmt.Errorf("tasks.PickRandom: %w", err)
	}
	return task, nil
}

// materialiseTaskAttempts creates ONE task_solve attempt + one
// question_answer attempt per task_question (interviewer follow-up). The
// task_solve row is created first so it appears first in the
// `created_at`-ordered list the frontend renders.
func (o *Orchestrator) materialiseTaskAttempts(ctx context.Context, stage domain.PipelineStage, pipe domain.MockPipeline) ([]AttemptView, error) {
	task, err := o.pickTaskForStage(ctx, stage, pipe)
	if err != nil {
		return nil, fmt.Errorf("pickTaskForStage: %w", err)
	}

	// 1) task_solve attempt — the actual coding submission.
	tID := task.ID
	solveAttempt := domain.PipelineAttempt{
		ID:              uuid.New(),
		PipelineStageID: stage.ID,
		Kind:            domain.AttemptTaskSolve,
		TaskID:          &tID,
		AIVerdict:       domain.AttemptVerdictPending,
		AIMissingPoints: []string{},
	}
	stored, err := o.Attempts.Create(ctx, solveAttempt)
	if err != nil {
		return nil, fmt.Errorf("attempts.Create task_solve: %w", err)
	}
	out := []AttemptView{{
		Attempt:                      stored,
		QuestionBody:                 task.Title + "\n\n" + task.BodyMD,
		ExpectedAnswerMD:             task.ReferenceSolutionMD,
		ReferenceCriteria:            task.ReferenceCriteria,
		TaskFunctionalRequirementsMD: task.FunctionalRequirementsMD,
		TaskLanguage:                 string(task.Language),
	}}

	// 2) one question_answer attempt per task_question (follow-ups).
	if o.Questions != nil {
		qs, qerr := o.Questions.ListTaskQuestions(ctx, task.ID)
		if qerr != nil {
			return nil, fmt.Errorf("questions.ListTaskQuestions: %w", qerr)
		}
		for _, q := range qs {
			tq := q
			a := domain.PipelineAttempt{
				ID:              uuid.New(),
				PipelineStageID: stage.ID,
				Kind:            domain.AttemptQuestionAnswer,
				TaskID:          &tID,
				TaskQuestionID:  &tq.ID,
				AIVerdict:       domain.AttemptVerdictPending,
				AIMissingPoints: []string{},
			}
			storedQ, err := o.Attempts.Create(ctx, a)
			if err != nil {
				return nil, fmt.Errorf("attempts.Create task_question[%s]: %w", tq.ID, err)
			}
			out = append(out, AttemptView{
				Attempt:                      storedQ,
				QuestionBody:                 tq.Body,
				ExpectedAnswerMD:             tq.ExpectedAnswerMD,
				ReferenceCriteria:            tq.ReferenceCriteria,
				TaskFunctionalRequirementsMD: task.FunctionalRequirementsMD,
				TaskLanguage:                 string(task.Language),
			})
		}
	}
	return out, nil
}

// materialiseSysDesignAttempts — Phase D.1. Picks one sysdesign task and
// creates ONE sysdesign_canvas attempt + one question_answer attempt per
// task_question. Layout matches algo/coding (canvas first, follow-ups
// after) so the frontend's `created_at`-ordered render is consistent.
func (o *Orchestrator) materialiseSysDesignAttempts(ctx context.Context, stage domain.PipelineStage, pipe domain.MockPipeline) ([]AttemptView, error) {
	task, err := o.pickTaskForStage(ctx, stage, pipe)
	if err != nil {
		return nil, fmt.Errorf("pickTaskForStage: %w", err)
	}

	tID := task.ID
	canvas := domain.PipelineAttempt{
		ID:              uuid.New(),
		PipelineStageID: stage.ID,
		Kind:            domain.AttemptSysDesignCanvas,
		TaskID:          &tID,
		AIVerdict:       domain.AttemptVerdictPending,
		AIMissingPoints: []string{},
	}
	stored, err := o.Attempts.Create(ctx, canvas)
	if err != nil {
		return nil, fmt.Errorf("attempts.Create sysdesign_canvas: %w", err)
	}
	out := []AttemptView{{
		Attempt: stored,
		// QuestionBody is the task body — frontend renders the prompt
		// next to the canvas. ExpectedAnswerMD carries the reference
		// solution for the judge (not shown to the user).
		QuestionBody:                 task.Title + "\n\n" + task.BodyMD,
		ExpectedAnswerMD:             task.ReferenceSolutionMD,
		ReferenceCriteria:            task.ReferenceCriteria,
		TaskFunctionalRequirementsMD: task.FunctionalRequirementsMD,
		TaskLanguage:                 string(task.Language),
	}}

	if o.Questions != nil {
		qs, qerr := o.Questions.ListTaskQuestions(ctx, task.ID)
		if qerr != nil {
			return nil, fmt.Errorf("questions.ListTaskQuestions: %w", qerr)
		}
		for _, q := range qs {
			tq := q
			a := domain.PipelineAttempt{
				ID:              uuid.New(),
				PipelineStageID: stage.ID,
				Kind:            domain.AttemptQuestionAnswer,
				TaskID:          &tID,
				TaskQuestionID:  &tq.ID,
				AIVerdict:       domain.AttemptVerdictPending,
				AIMissingPoints: []string{},
			}
			storedQ, err := o.Attempts.Create(ctx, a)
			if err != nil {
				return nil, fmt.Errorf("attempts.Create sysdesign question[%s]: %w", tq.ID, err)
			}
			out = append(out, AttemptView{
				Attempt:                      storedQ,
				QuestionBody:                 tq.Body,
				ExpectedAnswerMD:             tq.ExpectedAnswerMD,
				ReferenceCriteria:            tq.ReferenceCriteria,
				TaskFunctionalRequirementsMD: task.FunctionalRequirementsMD,
				TaskLanguage:                 string(task.Language),
			})
		}
	}
	return out, nil
}

// resolveQuestionLimits looks up the company_stages row for this
// (companyID, stageKind) pair and returns the configured sampling
// caps. Either return value may be nil ("take all"). Random-mode
// pipelines (companyID nil) always return (nil, nil).
func (o *Orchestrator) resolveQuestionLimits(ctx context.Context, stageKind domain.StageKind, companyID *uuid.UUID) (*int, *int) {
	if companyID == nil || *companyID == uuid.Nil || o.CompanyStages == nil {
		return nil, nil
	}
	cfgs, err := o.CompanyStages.GetForCompany(ctx, *companyID)
	if err != nil {
		return nil, nil
	}
	for _, c := range cfgs {
		if c.StageKind == stageKind {
			return c.DefaultQuestionLimit, c.CompanyQuestionLimit
		}
	}
	return nil, nil
}

// materialiseQuestionAttempts inserts one pipeline_attempt per default +
// company question for stages that don't carry tasks (HR, behavioral).
// Random mode (companyID nil) uses defaults only.
//
// Sampling: if the company_stages row has non-NULL default/company
// question_limit, the SQL `ORDER BY random() LIMIT N` form is used so a
// candidate doesn't have to answer all 200 seeded questions per session.
// NULL limit (or no company_stages row at all) preserves legacy "take
// every active row" behaviour.
func (o *Orchestrator) materialiseQuestionAttempts(ctx context.Context, stageID uuid.UUID, stageKind domain.StageKind, companyID *uuid.UUID) ([]AttemptView, error) {
	// Resolve sampling caps from company_stages. Caller-provided companyID
	// may be nil (random mode) — defaults to "no caps" then.
	defaultLimit, companyLimit := o.resolveQuestionLimits(ctx, stageKind, companyID)

	var defaults []domain.DefaultQuestion
	var err error
	switch {
	case defaultLimit != nil && *defaultLimit == 0:
		// Admin opted out of defaults entirely for this stage.
		defaults = nil
	case defaultLimit != nil && *defaultLimit > 0:
		defaults, err = o.Questions.SampleDefaultQuestions(ctx, stageKind, *defaultLimit)
	default:
		defaults, err = o.Questions.ListDefaultQuestions(ctx, stageKind, true)
	}
	if err != nil {
		return nil, fmt.Errorf("questions.defaults: %w", err)
	}

	var companyQs []domain.CompanyQuestion
	if companyID != nil && *companyID != uuid.Nil {
		switch {
		case companyLimit != nil && *companyLimit == 0:
			companyQs = nil
		case companyLimit != nil && *companyLimit > 0:
			companyQs, err = o.Questions.SampleCompanyQuestions(ctx, *companyID, stageKind, *companyLimit)
			if err != nil {
				return nil, fmt.Errorf("questions.SampleCompanyQuestions: %w", err)
			}
		default:
			all, err := o.Questions.ListCompanyQuestions(ctx, *companyID, stageKind)
			if err != nil {
				return nil, fmt.Errorf("questions.ListCompanyQuestions: %w", err)
			}
			// Active only — list returns all rows; filter here so the policy is
			// in one place.
			for _, q := range all {
				if q.Active {
					companyQs = append(companyQs, q)
				}
			}
		}
	}

	out := make([]AttemptView, 0, len(defaults)+len(companyQs))
	for _, d := range defaults {
		dq := d
		att := domain.PipelineAttempt{
			ID:                uuid.New(),
			PipelineStageID:   stageID,
			Kind:              domain.AttemptQuestionAnswer,
			DefaultQuestionID: &dq.ID,
			AIVerdict:         domain.AttemptVerdictPending,
			AIMissingPoints:   []string{},
		}
		stored, err := o.Attempts.Create(ctx, att)
		if err != nil {
			return nil, fmt.Errorf("attempts.Create default[%s]: %w", dq.ID, err)
		}
		out = append(out, AttemptView{
			Attempt:           stored,
			QuestionBody:      dq.Body,
			ExpectedAnswerMD:  dq.ExpectedAnswerMD,
			ReferenceCriteria: dq.ReferenceCriteria,
		})
	}
	for _, c := range companyQs {
		cq := c
		att := domain.PipelineAttempt{
			ID:                uuid.New(),
			PipelineStageID:   stageID,
			Kind:              domain.AttemptQuestionAnswer,
			CompanyQuestionID: &cq.ID,
			AIVerdict:         domain.AttemptVerdictPending,
			AIMissingPoints:   []string{},
		}
		stored, err := o.Attempts.Create(ctx, att)
		if err != nil {
			return nil, fmt.Errorf("attempts.Create company[%s]: %w", cq.ID, err)
		}
		out = append(out, AttemptView{
			Attempt:           stored,
			QuestionBody:      cq.Body,
			ExpectedAnswerMD:  cq.ExpectedAnswerMD,
			ReferenceCriteria: cq.ReferenceCriteria,
		})
	}
	return out, nil
}

// ── SubmitAnswer ────────────────────────────────────────────────────────

// SubmitAnswer scores a user answer for a single attempt — loads context,
// calls the judge, and persists the result.
func (o *Orchestrator) SubmitAnswer(ctx context.Context, attemptID uuid.UUID, userAnswer string) (domain.PipelineAttempt, error) {
	if strings.TrimSpace(userAnswer) == "" {
		return domain.PipelineAttempt{}, fmt.Errorf("user_answer empty: %w", domain.ErrValidation)
	}
	withQ, err := o.Attempts.GetWithQuestion(ctx, attemptID)
	if err != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("attempts.GetWithQuestion: %w", err)
	}
	stage, err := o.PipelineStages.Get(ctx, withQ.Attempt.PipelineStageID)
	if err != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("pipelineStages.Get: %w", err)
	}

	// Resolve the snapshotted profile. Fallback to a zero-value profile
	// (off_topic_penalty=0, bias_toward_fail=false) if the snapshot is
	// missing — safer than 500-ing on legacy rows.
	profile := domain.AIStrictnessProfile{}
	if stage.AIStrictnessProfileID != nil {
		p, perr := o.Strictness.ResolveStrictness(ctx, uuid.Nil, nil, stage.StageKind)
		if perr == nil {
			// Re-resolve produces the snapshotted (or current) profile.
			// We trust `stage.AIStrictnessProfileID` to mean "this profile
			// existed when the stage started"; any active drift is loaded
			// transparently. We keep this resolver-based on purpose so the
			// orchestrator doesn't need a direct StrictnessRepo dep.
			profile = p
		}
	}

	// For task_solve: ExpectedAnswerMD already holds the reference solution
	// (GetWithQuestion maps mock_tasks.reference_solution_md → expected). Pass
	// it explicitly via ReferenceSolutionMD so the code-review template can
	// use it without re-loading the task.
	//
	// For question_answer attempts that are linked to a task (task_id != nil)
	// — interviewer follow-ups about the task the user just solved — load the
	// task body so the judge sees "the question is in the context of THIS
	// task" via RelatedTaskMD.
	in := JudgeInput{
		QuestionBody:      withQ.QuestionBody,
		ExpectedAnswerMD:  withQ.ExpectedAnswerMD,
		ReferenceCriteria: withQ.ReferenceCriteria,
		UserAnswer:        userAnswer,
		StrictnessProfile: profile,
		StageKind:         stage.StageKind,
		Kind:              withQ.Attempt.Kind,
	}
	if withQ.Attempt.Kind == domain.AttemptTaskSolve {
		in.ReferenceSolutionMD = withQ.ExpectedAnswerMD
	}
	if withQ.Attempt.Kind == domain.AttemptQuestionAnswer && withQ.Attempt.TaskID != nil && o.Tasks != nil {
		if t, terr := o.Tasks.Get(ctx, *withQ.Attempt.TaskID); terr == nil {
			in.RelatedTaskMD = t.Title + "\n\n" + t.BodyMD
		}
	}

	out, err := o.Judge.JudgeAnswer(ctx, in)
	if err != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("judge.JudgeAnswer: %w", err)
	}

	// F-2: when this is a task_solve attempt and the sandbox is wired AND
	// the task has Judge0-runnable test cases, override the score / verdict
	// with the sandbox result (deterministic exact-match grading). The LLM
	// feedback is preserved as the markdown commentary because Judge0 only
	// produces a pass/fail signal — not a code review.
	if withQ.Attempt.Kind == domain.AttemptTaskSolve &&
		o.Sandbox != nil && o.Sandbox.Available() &&
		withQ.Attempt.TaskID != nil && o.Tasks != nil {
		if task, terr := o.Tasks.Get(ctx, *withQ.Attempt.TaskID); terr == nil {
			res, sErr := o.Sandbox.Submit(ctx, userAnswer, enums.Language(task.Language), task.ID)
			if sErr != nil {
				if !errors.Is(sErr, domain.ErrSandboxUnavailable) && o.Log != nil {
					o.Log.WarnContext(ctx, "mock_interview.orch: sandbox submit failed; using LLM-only verdict",
						slog.String("task_id", task.ID.String()), slog.Any("err", sErr))
				}
				// ErrSandboxUnavailable is the documented degradation path —
				// no log noise, just keep the LLM-derived verdict/score.
			} else {
				out.Score = float64(res.Score)
				out.Verdict = res.Verdict
				// Stitch a sandbox summary line into the LLM feedback so the
				// candidate sees BOTH the auto-grader result and the code review.
				out.Feedback = fmt.Sprintf("**Sandbox: %d/%d tests passed.**\n\n", res.PassedCount, res.Total) + out.Feedback
			}
		}
	}

	if uerr := o.Attempts.UpdateJudgeResult(ctx, attemptID, userAnswer,
		float32(out.Score), float32(out.WaterScore), out.Verdict,
		out.Feedback, out.MissingPoints); uerr != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("attempts.UpdateJudgeResult: %w", uerr)
	}

	updated, err := o.Attempts.Get(ctx, attemptID)
	if err != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("attempts.Get post-update: %w", err)
	}
	return updated, nil
}

// ── SubmitCanvas (Phase D.1) ────────────────────────────────────────────

// SubmitCanvasInput — payload for the sysdesign canvas submission.
//
// ImageDataURL must be a data:image/{png,jpeg};base64,… url; it is consumed
// once by the vision judge and discarded. The persistent record of the
// drawing is SceneJSON (Excalidraw scene + files), which the frontend re-
// renders in viewMode when the user reviews the attempt.
//
// UserID is used solely for the pipeline-ownership check (caller already
// authenticated).
type SubmitCanvasInput struct {
	AttemptID       uuid.UUID
	UserID          uuid.UUID
	ImageDataURL    string
	SceneJSON       []byte // raw Excalidraw scene blob; persisted as jsonb
	ContextMD       string
	NonFunctionalMD string
}

// SubmitCanvas — sysdesign-canvas analogue of SubmitAnswer. Loads attempt
// → stage → task, runs the multimodal judge, and persists the result via
// PipelineAttemptRepo.UpdateCanvasResult (single atomic UPDATE).
//
// Ownership: caller must own the parent pipeline. Returns ErrNotFound if
// not (same hide-existence convention as Get).
//
// Judge wiring: requires the configured Judge to also implement
// CanvasJudgeClient. If it doesn't (e.g. dev environment with a fake
// JudgeClient that only does JudgeAnswer), we persist errorFallback() so
// the user can retry once a vision-capable judge is wired.
func (o *Orchestrator) SubmitCanvas(ctx context.Context, in SubmitCanvasInput) (domain.PipelineAttempt, error) {
	if strings.TrimSpace(in.ImageDataURL) == "" {
		return domain.PipelineAttempt{}, fmt.Errorf("image_data_url empty: %w", domain.ErrValidation)
	}
	att, err := o.Attempts.Get(ctx, in.AttemptID)
	if err != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("attempts.Get: %w", err)
	}
	if att.Kind != domain.AttemptSysDesignCanvas {
		return domain.PipelineAttempt{}, fmt.Errorf("attempt kind=%s, want sysdesign_canvas: %w", att.Kind, domain.ErrConflict)
	}
	if att.TaskID == nil {
		return domain.PipelineAttempt{}, fmt.Errorf("sysdesign_canvas attempt without task_id: %w", domain.ErrConflict)
	}
	stage, err := o.PipelineStages.Get(ctx, att.PipelineStageID)
	if err != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("pipelineStages.Get: %w", err)
	}
	pipe, err := o.Pipelines.Get(ctx, stage.PipelineID)
	if err != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("pipelines.Get: %w", err)
	}
	if pipe.UserID != in.UserID {
		// Hide existence — same convention as ports.Get.
		return domain.PipelineAttempt{}, fmt.Errorf("not owner: %w", domain.ErrNotFound)
	}
	task, err := o.Tasks.Get(ctx, *att.TaskID)
	if err != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("tasks.Get: %w", err)
	}

	// Resolve strictness — same fallback semantics as SubmitAnswer.
	profile := domain.AIStrictnessProfile{}
	if stage.AIStrictnessProfileID != nil && o.Strictness != nil {
		if p, perr := o.Strictness.ResolveStrictness(ctx, task.ID, pipe.CompanyID, stage.StageKind); perr == nil {
			profile = p
		}
	}

	// Judge.
	canvasJudge, ok := o.Judge.(CanvasJudgeClient)
	var jOut JudgeOutput
	if !ok {
		if o.Log != nil {
			o.Log.WarnContext(ctx, "mock_interview.orch: judge does not implement CanvasJudgeClient — persisting fallback")
		}
		jOut = errorFallback()
	} else {
		jOut, err = canvasJudge.JudgeCanvas(ctx, JudgeCanvasInput{
			TaskBody:                 task.Title + "\n\n" + task.BodyMD,
			FunctionalRequirementsMD: task.FunctionalRequirementsMD,
			NonFunctionalMD:          in.NonFunctionalMD,
			ContextMD:                in.ContextMD,
			ImageDataURL:             in.ImageDataURL,
			ReferenceSolutionMD:      task.ReferenceSolutionMD,
			ReferenceCriteria:        task.ReferenceCriteria,
			StrictnessProfile:        profile,
		})
		if err != nil {
			return domain.PipelineAttempt{}, fmt.Errorf("judge.JudgeCanvas: %w", err)
		}
	}

	userAnswerMD := ""
	if strings.TrimSpace(in.NonFunctionalMD) != "" {
		userAnswerMD = "## Non-functional requirements\n\n" + in.NonFunctionalMD
	}

	// F-3 v2: PNG was consumed by the vision judge above and is now thrown
	// away. The Excalidraw scene blob is the persistent record — frontend
	// re-renders it in viewMode when the user revisits the attempt. Image
	// URL column stays empty for new rows; legacy rows keep their data URL.
	if uerr := o.Attempts.UpdateCanvasResult(ctx, in.AttemptID, domain.CanvasResultUpdate{
		SceneJSON:     in.SceneJSON,
		ContextMD:     in.ContextMD,
		UserAnswerMD:  userAnswerMD,
		Score:         float32(jOut.Score),
		Verdict:       jOut.Verdict,
		Feedback:      jOut.Feedback,
		MissingPoints: jOut.MissingPoints,
	}); uerr != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("attempts.UpdateCanvasResult: %w", uerr)
	}
	// Submit succeeded → the localStorage draft is also being cleared
	// client-side, but we drop the Redis fallback row eagerly so a stale
	// "restore" prompt never shows up on the next visit.
	o.deleteCanvasDraftBestEffort(ctx, in.AttemptID)

	updated, err := o.Attempts.Get(ctx, in.AttemptID)
	if err != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("attempts.Get post-update: %w", err)
	}
	return updated, nil
}

// ── FinishStage ─────────────────────────────────────────────────────────

// FinishStage aggregates non-pending attempts into a stage score + verdict,
// then bumps pipeline.current_stage_idx (or finishes the pipeline if last).
func (o *Orchestrator) FinishStage(ctx context.Context, stageID uuid.UUID) (domain.PipelineStage, error) {
	stage, err := o.PipelineStages.Get(ctx, stageID)
	if err != nil {
		return domain.PipelineStage{}, fmt.Errorf("pipelineStages.Get: %w", err)
	}
	atts, err := o.Attempts.ListByStage(ctx, stageID)
	if err != nil {
		return domain.PipelineStage{}, fmt.Errorf("attempts.ListByStage: %w", err)
	}

	var sum float64
	var n int
	missing := []string{}
	for _, a := range atts {
		if a.AIVerdict == domain.AttemptVerdictPending {
			continue
		}
		if a.AIScore != nil {
			sum += float64(*a.AIScore)
			n++
		}
		// Pull up to 3 missing points from across attempts for the stage
		// summary.
		for _, mp := range a.AIMissingPoints {
			if len(missing) >= 3 {
				break
			}
			missing = append(missing, mp)
		}
	}
	avg := float32(0)
	if n > 0 {
		avg = float32(sum / float64(n))
	}

	// Re-resolve profile to honour bias_toward_fail at stage level.
	bias := false
	if stage.AIStrictnessProfileID != nil && o.Strictness != nil {
		// Best-effort — we don't fail FinishStage if strictness lookup fails.
		profile, perr := o.Strictness.ResolveStrictness(ctx, uuid.Nil, nil, stage.StageKind)
		if perr == nil {
			bias = profile.BiasTowardFail
		}
	}
	verdict := stageVerdictFromScore(avg, bias)

	feedback := ""
	if len(missing) > 0 {
		feedback = "Главное, что стоит подтянуть:\n- " + strings.Join(missing, "\n- ") + "\n\nХорошо поработал, разбор выше."
	} else if n > 0 {
		feedback = "Стадия пройдена уверенно — критичных пробелов не нашлось."
	}

	if ferr := o.PipelineStages.FinishStage(ctx, stageID, avg, verdict, feedback); ferr != nil {
		return domain.PipelineStage{}, fmt.Errorf("pipelineStages.FinishStage: %w", ferr)
	}

	stage.Status = domain.StageStatusFinished
	stage.Score = &avg
	stage.Verdict = &verdict
	stage.AIFeedbackMD = feedback
	t := o.now()
	stage.FinishedAt = &t

	// Bump pipeline cursor; if there are no more stages, finish pipeline.
	all, err := o.PipelineStages.ListByPipeline(ctx, stage.PipelineID)
	if err != nil {
		return stage, fmt.Errorf("pipelineStages.ListByPipeline: %w", err)
	}
	hasMore := false
	for _, s := range all {
		if s.Status == domain.StageStatusPending {
			hasMore = true
			break
		}
	}
	if _, err := o.Pipelines.IncrementStageIdx(ctx, stage.PipelineID); err != nil {
		// Non-fatal for the stage's own state, but log.
		if o.Log != nil {
			o.Log.WarnContext(ctx, "mock_interview.orch: IncrementStageIdx failed", slog.Any("err", err))
		}
	}
	if !hasMore {
		if _, err := o.FinishPipeline(ctx, stage.PipelineID); err != nil {
			return stage, fmt.Errorf("FinishPipeline: %w", err)
		}
	}
	return stage, nil
}

func stageVerdictFromScore(score float32, biasFail bool) domain.StageVerdict {
	switch {
	case score >= 70:
		return domain.StageVerdictPass
	case score < 50:
		return domain.StageVerdictFail
	default:
		if biasFail {
			return domain.StageVerdictFail
		}
		return domain.StageVerdictBorderline
	}
}

// ── FinishPipeline ──────────────────────────────────────────────────────

// FinishPipeline aggregates stage verdicts → pipeline pass/fail and writes
// total_score + finished_at.
func (o *Orchestrator) FinishPipeline(ctx context.Context, pipelineID uuid.UUID) (domain.MockPipeline, error) {
	pipe, err := o.Pipelines.Get(ctx, pipelineID)
	if err != nil {
		return domain.MockPipeline{}, fmt.Errorf("pipelines.Get: %w", err)
	}
	stages, err := o.PipelineStages.ListByPipeline(ctx, pipelineID)
	if err != nil {
		return domain.MockPipeline{}, fmt.Errorf("pipelineStages.ListByPipeline: %w", err)
	}

	// Resolve required vs optional stages. Random mode (companyID==nil)
	// treats all as required. With companyID set, look up company_stages
	// and honour `optional`.
	requiredOptional := map[domain.StageKind]bool{}
	if pipe.CompanyID != nil && *pipe.CompanyID != uuid.Nil && o.CompanyStages != nil {
		cfgs, err := o.CompanyStages.GetForCompany(ctx, *pipe.CompanyID)
		if err == nil {
			for _, c := range cfgs {
				requiredOptional[c.StageKind] = c.Optional
			}
		}
	}

	verdict := domain.PipelinePass
	var sum float64
	var n int
	for _, s := range stages {
		if s.Score != nil {
			sum += float64(*s.Score)
			n++
		}
		// Optional stages can fail without dragging the pipeline.
		isOptional := requiredOptional[s.StageKind]
		if !isOptional {
			if s.Verdict == nil || *s.Verdict != domain.StageVerdictPass {
				verdict = domain.PipelineFail
			}
		}
	}
	var totalScore *float32
	if n > 0 {
		v := float32(sum / float64(n))
		totalScore = &v
	}

	if err := o.Pipelines.UpdateVerdict(ctx, pipelineID, verdict, totalScore); err != nil {
		return domain.MockPipeline{}, fmt.Errorf("pipelines.UpdateVerdict: %w", err)
	}
	pipe.Verdict = verdict
	pipe.TotalScore = totalScore
	t := o.now()
	pipe.FinishedAt = &t

	// Sweep canvas drafts for every sysdesign attempt of this pipeline —
	// the run is over, restoring half-drawn diagrams next time would only
	// confuse the user.
	o.sweepCanvasDraftsForPipeline(ctx, stages)

	// Coach memory: write a `mock_pipeline_finished` episode so future
	// Daily Briefs can reference this session. Best-effort, never blocks.
	if o.Memory != nil {
		o.Memory.OnPipelineFinished(ctx, pipe.UserID, pipelineID, verdict, totalScore, stages, t)
	}

	// Atlas progress: stage.score → skill_nodes.progress for the node
	// that backs that stage. UpsertSkillNode уже делает GREATEST, поэтому
	// fail-stage не уронит прежний прогресс — только pass / borderline
	// его двигают вверх. Best-effort: ошибка не валит FinishPipeline.
	o.bumpAtlasFromStages(ctx, pipe.UserID, stages)

	// TODO: publish leaderboard event with ai_assist=pipeline.AIAssist watermark
	return pipe, nil
}

// stageToAtlasNode — primary atlas node_key per stage_kind. Maps
// directly to the seeded atlas catalogue (см. migration 00002):
//   - algo       → algo_basics  (массивы, хеш-таблицы, two-pointers)
//   - coding     → go_concurrency (главный коридор coding-практики)
//   - sysdesign  → sd_basics
//   - behavioral → beh_star
//   - hr         — пропускается (HR не «навык»)
var stageToAtlasNode = map[domain.StageKind]string{
	domain.StageAlgo:       "algo_basics",
	domain.StageCoding:     "go_concurrency",
	domain.StageSysDesign:  "sd_basics",
	domain.StageBehavioral: "beh_star",
}

// bumpAtlasFromStages пробегает по финальным stages и upsert'ит
// прогресс по тем, для которых известен node_key. Без Skills (nil)
// — no-op. Failures логируем и идём дальше: атлас — side-effect, не
// часть атомарного finish-pipeline.
func (o *Orchestrator) bumpAtlasFromStages(ctx context.Context, userID uuid.UUID, stages []domain.PipelineStage) {
	if o.Skills == nil {
		return
	}
	for _, s := range stages {
		nodeKey, ok := stageToAtlasNode[s.StageKind]
		if !ok {
			continue
		}
		if s.Score == nil {
			continue
		}
		progress := int(*s.Score)
		if progress < 0 {
			progress = 0
		}
		if progress > 100 {
			progress = 100
		}
		if err := o.Skills.UpsertSkillNode(ctx, userID, nodeKey, progress); err != nil {
			if o.Log != nil {
				o.Log.WarnContext(ctx, "mock_interview.orch: atlas bump failed",
					slog.Any("err", err),
					slog.String("node_key", nodeKey),
					slog.String("stage", string(s.StageKind)))
			}
		}
	}
}

// sweepCanvasDraftsForPipeline walks every sysdesign attempt under
// `stages` and DELs its draft from the Redis fallback. Best-effort —
// failures are logged, never propagated.
func (o *Orchestrator) sweepCanvasDraftsForPipeline(ctx context.Context, stages []domain.PipelineStage) {
	if o.CanvasDrafts == nil {
		return
	}
	for _, s := range stages {
		atts, err := o.Attempts.ListByStage(ctx, s.ID)
		if err != nil {
			continue
		}
		for _, a := range atts {
			if a.Kind != domain.AttemptSysDesignCanvas {
				continue
			}
			o.deleteCanvasDraftBestEffort(ctx, a.ID)
		}
	}
}

// deleteCanvasDraftBestEffort drops a single draft, logging but not
// returning errors. Callers use this from happy-path code where a stuck
// draft is preferable to a failed Submit.
func (o *Orchestrator) deleteCanvasDraftBestEffort(ctx context.Context, attemptID uuid.UUID) {
	if o.CanvasDrafts == nil {
		return
	}
	if err := o.CanvasDrafts.Delete(ctx, attemptID); err != nil && o.Log != nil {
		o.Log.WarnContext(ctx, "mock_interview.orch: canvas draft delete failed",
			slog.Any("err", err), slog.String("attempt_id", attemptID.String()))
	}
}

// ── CancelPipeline ──────────────────────────────────────────────────────

// CancelPipeline marks a pipeline cancelled. Caller must own it.
func (o *Orchestrator) CancelPipeline(ctx context.Context, pipelineID, userID uuid.UUID) error {
	pipe, err := o.Pipelines.Get(ctx, pipelineID)
	if err != nil {
		return fmt.Errorf("pipelines.Get: %w", err)
	}
	if pipe.UserID != userID {
		return fmt.Errorf("not owner: %w", domain.ErrNotFound)
	}
	// Idempotent: a second cancel from a stuck-spinner client must succeed
	// silently rather than 409/500. Pipelines that already settled into a
	// terminal verdict stay as-is — only an in_progress pipeline transitions
	// to cancelled.
	if pipe.Verdict != domain.PipelineInProgress {
		return nil
	}
	if err := o.Pipelines.UpdateVerdict(ctx, pipelineID, domain.PipelineCancelled, nil); err != nil {
		return fmt.Errorf("pipelines.UpdateVerdict: %w", err)
	}
	// Cancelled run is over → wipe sysdesign drafts. Best-effort, not
	// part of the cancel atomicity contract.
	if stages, sErr := o.PipelineStages.ListByPipeline(ctx, pipelineID); sErr == nil {
		o.sweepCanvasDraftsForPipeline(ctx, stages)
	}
	return nil
}

// ── GetPipelineFull ─────────────────────────────────────────────────────

// PipelineFull is the read-projection for the extended GET endpoint —
// pipeline + stages + each stage's attempts (with question bodies).
type PipelineFull struct {
	Pipeline domain.MockPipeline
	Stages   []StageWithAttempts
}

// GetPipelineFull walks pipeline → stages → attempts and resolves question
// bodies. Used by GET /api/v1/mock/pipelines/{id}.
func (o *Orchestrator) GetPipelineFull(ctx context.Context, pipelineID uuid.UUID) (PipelineFull, error) {
	pipe, err := o.Pipelines.Get(ctx, pipelineID)
	if err != nil {
		return PipelineFull{}, fmt.Errorf("pipelines.Get: %w", err)
	}
	stages, err := o.PipelineStages.ListByPipeline(ctx, pipelineID)
	if err != nil {
		return PipelineFull{}, fmt.Errorf("pipelineStages.ListByPipeline: %w", err)
	}
	out := make([]StageWithAttempts, 0, len(stages))
	for _, s := range stages {
		atts, err := o.Attempts.ListByStage(ctx, s.ID)
		if err != nil {
			return PipelineFull{}, fmt.Errorf("attempts.ListByStage: %w", err)
		}
		views := make([]AttemptView, 0, len(atts))
		for _, a := range atts {
			view := AttemptView{Attempt: a}
			// Resolve the question body via GetWithQuestion (one query per
			// attempt — N+1, but N is small for HR; revisit if it shows up).
			withQ, err := o.Attempts.GetWithQuestion(ctx, a.ID)
			if err != nil && !errors.Is(err, domain.ErrNotFound) {
				return PipelineFull{}, fmt.Errorf("attempts.GetWithQuestion: %w", err)
			}
			if err == nil {
				view.QuestionBody = withQ.QuestionBody
				view.ExpectedAnswerMD = withQ.ExpectedAnswerMD
				view.ReferenceCriteria = withQ.ReferenceCriteria
				view.TaskFunctionalRequirementsMD = withQ.TaskFunctionalRequirementsMD
				view.TaskLanguage = withQ.TaskLanguage
			}
			views = append(views, view)
		}
		out = append(out, StageWithAttempts{Stage: s, Attempts: views})
	}
	return PipelineFull{Pipeline: pipe, Stages: out}, nil
}
