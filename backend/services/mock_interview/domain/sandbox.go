package domain

import (
	"context"
	"errors"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ErrSandboxUnavailable — sentinel returned when the code-execution sandbox
// is misconfigured / unreachable / language unsupported. Orchestrator falls
// back to the LLM code-reviewer judge so the feature stays usable.
var ErrSandboxUnavailable = errors.New("mock_interview.sandbox: unavailable")

// MockTaskTestCase — single grading row for a task_solve attempt. Mirrors
// daily.test_cases: stdin → expected_stdout exact match (trimmed).
type MockTaskTestCase struct {
	ID       uuid.UUID
	TaskID   uuid.UUID
	Input    string
	Expected string
	IsHidden bool
	Ordinal  int
}

// MockTaskTestCaseRepo persists `mock_task_test_cases`. The admin
// surface uses Create/Update/Delete; the orchestrator only needs
// ListForTask. Both share the same row shape.
type MockTaskTestCaseRepo interface {
	ListForTask(ctx context.Context, taskID uuid.UUID) ([]MockTaskTestCase, error)
	Create(ctx context.Context, tc MockTaskTestCase) (MockTaskTestCase, error)
	Update(ctx context.Context, tc MockTaskTestCase) (MockTaskTestCase, error)
	Delete(ctx context.Context, id uuid.UUID) error
}

// SandboxResult — outcome of running every test case for one task_solve
// submission. Score is the percentage of cases passed (0..100); Verdict is
// pass when all cases match exactly.
type SandboxResult struct {
	Total       int
	PassedCount int
	Score       float32
	Verdict     AttemptVerdict
}

// SandboxCaseResult — per-test outcome surfaced by SubmitDetailed. Used by
// the Algo «Run tests» path so the frontend can show per-case pass/fail.
// Hidden cases are still executed (and counted in Total/Passed) but the
// caller is responsible for stripping their Input/Expected/Actual before
// returning to the client.
type SandboxCaseResult struct {
	Ordinal    int
	Passed     bool
	Input      string
	Expected   string
	Actual     string
	Stderr     string
	IsHidden   bool
	RuntimeMs  int
	MemoryKB   int
}

// SandboxExecutor — code-execution adapter. Single Submit per attempt; the
// implementation iterates over the task's grading rows internally. Returns
// ErrSandboxUnavailable on transport / config / unsupported-language so the
// caller can degrade gracefully.
type SandboxExecutor interface {
	Available() bool
	Submit(ctx context.Context, code string, language enums.Language, taskID uuid.UUID) (SandboxResult, error)
}

// DetailedSandboxExecutor — optional capability for per-case granularity.
// Used by the Algo «Run tests» dry-run path. Implementations that don't
// support it are gated via a type-assertion in the use case (orchestrator
// keeps using the aggregate Submit path).
type DetailedSandboxExecutor interface {
	SandboxExecutor
	// SubmitDetailed runs every test case and returns the per-case outcome
	// alongside aggregate counts. Hidden cases are present in the slice
	// with IsHidden=true; callers are responsible for redaction.
	SubmitDetailed(ctx context.Context, code string, language enums.Language, taskID uuid.UUID) ([]SandboxCaseResult, error)
}
