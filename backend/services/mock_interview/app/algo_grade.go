// Package app — algo_grade.go: «Run tests» dry-run for the Algo stage.
//
// Unlike SubmitAnswer (which finalises an attempt via the LLM judge + sandbox
// override), RunAlgo executes the candidate's code against the visible
// test-cases for the task rooted on the attempt and returns per-case results
// WITHOUT touching pipeline_attempts. The candidate keeps iterating until
// they hit «Submit», at which point SubmitAnswer takes over and persists.
//
// Ownership: the caller is expected to enforce pipeline-owner. This UC only
// loads the attempt + parent task and refuses non-task_solve / non-algo
// kinds, so accidentally calling it from another stage is a 400 not a 500.
//
// Sandbox availability: ErrSandboxUnavailable returns a structured verdict
// with sandbox_unavailable=true rather than 503 — the frontend then renders
// "Run tests temporarily unavailable" inline next to the editor instead of
// a full-page error toast.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"druz9/mock_interview/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// algoOutputCap bounds per-case stdout/stderr/expected output. Judge0 caps
// at ~256 KB which is fine for grading but blows up Connect responses;
// 2 KB is enough to see the diff in a UI snippet.
const algoOutputCap = 2 * 1024

// AlgoStatus enumerates the short status code returned to the frontend.
// Kept as string aliases so this file is the single source of truth for
// the proto string field; tests assert on the constants below.
type AlgoStatus string

const (
	AlgoStatusOK           AlgoStatus = "ok"
	AlgoStatusCompileError AlgoStatus = "compile_error"
	AlgoStatusRuntimeError AlgoStatus = "runtime_error"
	AlgoStatusUnavailable  AlgoStatus = "unavailable"
	AlgoStatusInvalid      AlgoStatus = "invalid"
)

// RunAlgoInput — everything the UC needs.
type RunAlgoInput struct {
	AttemptID uuid.UUID
	Code      string
	Language  string // shared/enums.Language string form
}

// RunAlgoOutput mirrors the proto AlgoVerdict shape. Per-case Input /
// Expected / Actual are pre-redacted for hidden cases.
type RunAlgoOutput struct {
	Passed              int
	Total               int
	RuntimeMs           int
	MemoryKB            int
	SandboxUnavailable  bool
	Status              AlgoStatus
	Tests               []AlgoCaseOutput
}

// AlgoCaseOutput — single test case result for the wire.
type AlgoCaseOutput struct {
	Ordinal   int
	Passed    bool
	Input     string
	Expected  string
	Actual    string
	Stderr    string
	IsHidden  bool
	RuntimeMs int
}

// AlgoGrader is the use-case bundle. Sandbox is required (the whole point of
// the UC is to call Judge0); Attempts + Tasks are required for the
// attempt → task → cases chain. Log is nil-safe.
type AlgoGrader struct {
	Sandbox  domain.SandboxExecutor // Type-asserted to DetailedSandboxExecutor at Run time
	Attempts domain.PipelineAttemptRepo
	Tasks    domain.TaskRepo
	Stages   domain.PipelineStageRepo
	Log      *slog.Logger
}

// Run executes the candidate's code against the task's test-cases and
// returns a verdict. NEVER mutates pipeline_attempts — the candidate's
// score is only updated by SubmitAnswer.
//
// Validation cascade:
//  1. code non-empty
//  2. language is a known free-LLM-supported sandbox language (SQL → unavailable)
//  3. attempt is kind=task_solve
//  4. parent stage is kind=algo (we reuse this UC for coding too, future)
//  5. task has at least one test case
//
// On (4) we currently accept BOTH algo and coding stages — the wire shape is
// identical and we want code reuse. SubmitAnswer already routes to the
// LLM judge appropriately; this UC is sandbox-only so it's stage-agnostic
// as long as the attempt has a TaskID.
func (g *AlgoGrader) Run(ctx context.Context, in RunAlgoInput) (RunAlgoOutput, error) {
	if strings.TrimSpace(in.Code) == "" {
		return RunAlgoOutput{}, fmt.Errorf("code empty: %w", domain.ErrValidation)
	}
	rawLang := strings.ToLower(strings.TrimSpace(in.Language))
	if rawLang == "" {
		return RunAlgoOutput{}, fmt.Errorf("language empty: %w", domain.ErrValidation)
	}
	lang := enums.Language(rawLang)
	if !lang.IsValid() {
		// Known-but-unsupported sandbox languages (cpp/java/etc.) — frontend
		// shows them in the selector for parity with task.language values, but
		// we degrade to structured unavailable rather than ErrValidation так
		// чтобы UI продолжил работать с подсказкой «Sandbox недоступен».
		// Анти-fallback: жесткий 400 только для совсем мусорных значений
		// (которые ниже не попадают в этот блок — IsValid принимает алиасы
		// shared/enums).
		if knownExtraLang(rawLang) {
			return RunAlgoOutput{
				SandboxUnavailable: true,
				Status:             AlgoStatusUnavailable,
			}, nil
		}
		return RunAlgoOutput{}, fmt.Errorf("language %q: %w", in.Language, domain.ErrValidation)
	}

	att, err := g.Attempts.Get(ctx, in.AttemptID)
	if err != nil {
		return RunAlgoOutput{}, fmt.Errorf("attempts.Get: %w", err)
	}
	if att.Kind != domain.AttemptTaskSolve {
		return RunAlgoOutput{}, fmt.Errorf("attempt kind=%s, want task_solve: %w", att.Kind, domain.ErrConflict)
	}
	if att.TaskID == nil {
		return RunAlgoOutput{}, fmt.Errorf("attempt missing task_id: %w", domain.ErrConflict)
	}

	// Stage check is defence-in-depth — the orchestrator only materialises
	// task_solve under algo/coding/sysdesign anyway. We still want a clear
	// error if a future refactor opens task_solve to other kinds.
	if g.Stages != nil {
		stage, sErr := g.Stages.Get(ctx, att.PipelineStageID)
		if sErr == nil {
			switch stage.StageKind {
			case domain.StageAlgo, domain.StageCoding, domain.StageMLCoding:
				// ok — ml_coding shares the Judge0 dry-run path; the sandbox
				// must be wired to the custom Judge0 image with ML libs
				// (см. infra/judge0/Dockerfile.ml-python). На стоковом
				// Judge0 «import numpy» падает с ModuleNotFoundError →
				// `unavailable` verdict, не 5xx.
			default:
				return RunAlgoOutput{}, fmt.Errorf("stage_kind=%s not eligible for run-algo: %w", stage.StageKind, domain.ErrConflict)
			}
		}
	}

	if g.Sandbox == nil {
		return RunAlgoOutput{
			SandboxUnavailable: true,
			Status:             AlgoStatusUnavailable,
		}, nil
	}
	detailed, ok := g.Sandbox.(domain.DetailedSandboxExecutor)
	if !ok || !g.Sandbox.Available() {
		return RunAlgoOutput{
			SandboxUnavailable: true,
			Status:             AlgoStatusUnavailable,
		}, nil
	}

	cases, runErr := detailed.SubmitDetailed(ctx, in.Code, lang, *att.TaskID)
	if runErr != nil {
		if errors.Is(runErr, domain.ErrSandboxUnavailable) {
			return RunAlgoOutput{
				SandboxUnavailable: true,
				Status:             AlgoStatusUnavailable,
			}, nil
		}
		// Non-sandbox-unavailable error from Submit — log it but still
		// hand back a structured verdict so the UI never sees a 500 from
		// the «Run tests» button.
		if g.Log != nil {
			g.Log.WarnContext(ctx, "mock_interview.algo_grade: sandbox detailed run failed",
				slog.Any("err", runErr))
		}
		return RunAlgoOutput{
			SandboxUnavailable: true,
			Status:             AlgoStatusUnavailable,
		}, nil
	}

	return buildVerdict(cases), nil
}

// buildVerdict maps the sandbox per-case slice into the proto-friendly
// shape: hidden cases get input/expected/actual redacted, outputs are
// truncated, and aggregate counters are computed. Status logic:
//   - any stderr non-empty AND no passing case → compile/runtime error.
//   - else if all passed → ok.
//   - else ok (mixed pass/fail is still status=ok; the per-case array tells
//     the candidate which cases failed).
//
// We distinguish compile vs runtime by checking whether ALL cases produced
// stderr (compile errors fail every case identically) vs only some
// (runtime / wrong answer mix).
func buildVerdict(cases []domain.SandboxCaseResult) RunAlgoOutput {
	out := RunAlgoOutput{Total: len(cases), Tests: make([]AlgoCaseOutput, 0, len(cases))}
	stderrCount := 0
	maxRuntime := 0
	maxMemory := 0
	for _, c := range cases {
		if c.Passed {
			out.Passed++
		}
		if strings.TrimSpace(c.Stderr) != "" {
			stderrCount++
		}
		if c.RuntimeMs > maxRuntime {
			maxRuntime = c.RuntimeMs
		}
		if c.MemoryKB > maxMemory {
			maxMemory = c.MemoryKB
		}
		co := AlgoCaseOutput{
			Ordinal:   c.Ordinal,
			Passed:    c.Passed,
			IsHidden:  c.IsHidden,
			RuntimeMs: c.RuntimeMs,
			Stderr:    truncate(c.Stderr, algoOutputCap),
		}
		if !c.IsHidden {
			co.Input = truncate(c.Input, algoOutputCap)
			co.Expected = truncate(c.Expected, algoOutputCap)
			co.Actual = truncate(c.Actual, algoOutputCap)
		}
		out.Tests = append(out.Tests, co)
	}
	out.RuntimeMs = maxRuntime
	out.MemoryKB = maxMemory

	switch {
	case out.Total == 0:
		out.Status = AlgoStatusInvalid
	case stderrCount == out.Total && out.Passed == 0:
		out.Status = AlgoStatusCompileError
	case stderrCount > 0 && out.Passed == 0:
		out.Status = AlgoStatusRuntimeError
	default:
		out.Status = AlgoStatusOK
	}
	return out
}

// truncate clips a string to n bytes, appending an ellipsis marker so the
// UI can show that more content was cut. Multi-byte safe is not required
// here — stdout/stderr from sandboxes is rarely UTF-8 boundary-sensitive.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "\n…(truncated)"
}

// knownExtraLang — languages we show in the UI selector but stock Judge0
// doesn't run via the shared enum (cpp, java). Returns true for those so the
// UC can degrade to a structured unavailable verdict instead of 400.
func knownExtraLang(s string) bool {
	switch s {
	case "cpp", "c++", "java":
		return true
	}
	return false
}
