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

// SandboxExecutor — code-execution adapter. Single Submit per attempt; the
// implementation iterates over the task's grading rows internally. Returns
// ErrSandboxUnavailable on transport / config / unsupported-language so the
// caller can degrade gracefully.
type SandboxExecutor interface {
	Available() bool
	Submit(ctx context.Context, code string, language enums.Language, taskID uuid.UUID) (SandboxResult, error)
}
