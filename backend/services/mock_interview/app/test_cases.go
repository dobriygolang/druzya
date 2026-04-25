// test_cases.go — admin CRUD over mock_task_test_cases plus a small
// bulk-import path. The orchestrator only consumes ListForTask
// (judge0_sandbox.go); these methods exist to back the admin UI.
package app

import (
	"context"
	"fmt"
	"strings"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// ListTestCases returns every grading row for a task, ordered by ordinal.
func (h *Handlers) ListTestCases(ctx context.Context, taskID uuid.UUID) ([]domain.MockTaskTestCase, error) {
	out, err := h.TestCases.ListForTask(ctx, taskID)
	if err != nil {
		return nil, fmt.Errorf("test_cases.ListForTask: %w", err)
	}
	return out, nil
}

// CreateTestCase wires a new row, validating non-empty input/expected.
// Empty strings would silently match Judge0 stdout="" and produce
// false-positive passes — anti-fallback policy.
func (h *Handlers) CreateTestCase(ctx context.Context, tc domain.MockTaskTestCase) (domain.MockTaskTestCase, error) {
	if strings.TrimSpace(tc.Input) == "" {
		return domain.MockTaskTestCase{}, fmt.Errorf("input required: %w", domain.ErrValidation)
	}
	if strings.TrimSpace(tc.Expected) == "" {
		return domain.MockTaskTestCase{}, fmt.Errorf("expected_output required: %w", domain.ErrValidation)
	}
	if tc.TaskID == uuid.Nil {
		return domain.MockTaskTestCase{}, fmt.Errorf("task_id required: %w", domain.ErrValidation)
	}
	out, err := h.TestCases.Create(ctx, tc)
	if err != nil {
		return domain.MockTaskTestCase{}, fmt.Errorf("test_cases.Create: %w", err)
	}
	return out, nil
}

// UpdateTestCase same validations as Create.
func (h *Handlers) UpdateTestCase(ctx context.Context, tc domain.MockTaskTestCase) (domain.MockTaskTestCase, error) {
	if tc.ID == uuid.Nil {
		return domain.MockTaskTestCase{}, fmt.Errorf("id required: %w", domain.ErrValidation)
	}
	if strings.TrimSpace(tc.Input) == "" {
		return domain.MockTaskTestCase{}, fmt.Errorf("input required: %w", domain.ErrValidation)
	}
	if strings.TrimSpace(tc.Expected) == "" {
		return domain.MockTaskTestCase{}, fmt.Errorf("expected_output required: %w", domain.ErrValidation)
	}
	out, err := h.TestCases.Update(ctx, tc)
	if err != nil {
		return domain.MockTaskTestCase{}, fmt.Errorf("test_cases.Update: %w", err)
	}
	return out, nil
}

// DeleteTestCase removes a row by id.
func (h *Handlers) DeleteTestCase(ctx context.Context, id uuid.UUID) error {
	if err := h.TestCases.Delete(ctx, id); err != nil {
		return fmt.Errorf("test_cases.Delete: %w", err)
	}
	return nil
}

// BulkTaskImport — payload for POST /admin/mock/tasks/bulk-import.
// Each item creates a new task plus its test cases in a single call.
// Failures on individual items don't abort the batch — we accumulate
// results so the admin sees per-row outcomes.
type BulkTaskImport struct {
	Tasks []BulkTaskImportItem `json:"tasks"`
}

// BulkTaskImportItem mirrors the create-task DTO + an optional
// test_cases array.
type BulkTaskImportItem struct {
	StageKind                domain.StageKind         `json:"stage_kind"`
	Language                 domain.TaskLanguage      `json:"language"`
	Difficulty               int                      `json:"difficulty"`
	Title                    string                   `json:"title"`
	BodyMD                   string                   `json:"body_md"`
	SampleIOMD               string                   `json:"sample_io_md"`
	ReferenceCriteria        domain.ReferenceCriteria `json:"reference_criteria"`
	ReferenceSolutionMD      string                   `json:"reference_solution_md"`
	FunctionalRequirementsMD string                   `json:"functional_requirements_md"`
	TimeLimitMin             int                      `json:"time_limit_min"`
	LLMModel                 string                   `json:"llm_model"`
	Active                   bool                     `json:"active"`
	TestCases                []BulkTestCase           `json:"test_cases"`
}

// BulkTestCase — minimal shape for inline cases on import.
type BulkTestCase struct {
	Input    string `json:"input"`
	Expected string `json:"expected_output"`
	IsHidden bool   `json:"is_hidden"`
	Ordinal  int    `json:"ordinal"`
}

// BulkImportResult — per-row outcome.
type BulkImportResult struct {
	Index          int    `json:"index"`
	TaskID         string `json:"task_id,omitempty"`
	TestCasesAdded int    `json:"test_cases_added"`
	Error          string `json:"error,omitempty"`
}

// BulkImportTasks runs the import. We do best-effort per-item rather
// than wrapping the batch in a transaction — the admin nearly always
// wants partial success ("70 of 80 imported, here are the bad rows").
func (h *Handlers) BulkImportTasks(ctx context.Context, in BulkTaskImport, adminID *uuid.UUID) ([]BulkImportResult, error) {
	results := make([]BulkImportResult, 0, len(in.Tasks))
	for i, item := range in.Tasks {
		res := BulkImportResult{Index: i}
		task := domain.MockTask{
			ID:                       uuid.New(),
			StageKind:                item.StageKind,
			Language:                 item.Language,
			Difficulty:               item.Difficulty,
			Title:                    item.Title,
			BodyMD:                   item.BodyMD,
			SampleIOMD:               item.SampleIOMD,
			ReferenceCriteria:        item.ReferenceCriteria,
			ReferenceSolutionMD:      item.ReferenceSolutionMD,
			FunctionalRequirementsMD: item.FunctionalRequirementsMD,
			TimeLimitMin:             item.TimeLimitMin,
			LLMModel:                 item.LLMModel,
			Active:                   item.Active,
			CreatedByAdminID:         adminID,
		}
		created, err := h.Tasks.Create(ctx, task)
		if err != nil {
			res.Error = fmt.Sprintf("create task: %v", err)
			results = append(results, res)
			continue
		}
		res.TaskID = created.ID.String()
		for _, tc := range item.TestCases {
			if strings.TrimSpace(tc.Input) == "" || strings.TrimSpace(tc.Expected) == "" {
				continue
			}
			if _, terr := h.TestCases.Create(ctx, domain.MockTaskTestCase{
				TaskID:   created.ID,
				Input:    tc.Input,
				Expected: tc.Expected,
				IsHidden: tc.IsHidden,
				Ordinal:  tc.Ordinal,
			}); terr != nil {
				// Surface in error string but don't abort — keep going so
				// the admin sees how many cases landed.
				res.Error = fmt.Sprintf("test case %d: %v", res.TestCasesAdded, terr)
				break
			}
			res.TestCasesAdded++
		}
		results = append(results, res)
	}
	return results, nil
}
