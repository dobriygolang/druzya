// pipeline_validate.go — R7 Phase 1.
//
// ValidatePipeline reads a company's stage config and reports per-stage
// readiness: each stage needs ≥1 task (for task_solve kinds) OR ≥1
// question (for question_answer kinds), плюс strictness profile.
//
// Lives in services/admin/ (chi-direct surface) — другой агент держит
// mock_interview/app+ports; cross-context чтение через PipelineValidator
// reader port + adminInfra.NewPipelineValidatorReader.
package app

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// StageValidation — one stage entry in the report.
type StageValidation struct {
	StageKind      string   `json:"stage_kind"`
	Ordinal        int      `json:"ordinal"`
	TaskCount      int      `json:"task_count"`
	QuestionCount  int      `json:"question_count"`
	HasStrictness  bool     `json:"has_strictness"`
	IsTaskSolve    bool     `json:"is_task_solve"`
	IsQuestionPool bool     `json:"is_question_pool"`
	Errors         []string `json:"errors"`
}

// ValidationReport — aggregate response.
type ValidationReport struct {
	CompanyID string            `json:"company_id"`
	Ok        bool              `json:"ok"`
	Stages    []StageValidation `json:"stages"`
}

// PipelineValidatorReader is the cross-context port admin uses to read
// stage / pool counts. Implementation lives in admin/infra so no mock
// service code is touched.
type PipelineValidatorReader interface {
	// StagesForCompany returns the company's stages ordered by ordinal.
	StagesForCompany(ctx context.Context, companyID uuid.UUID) ([]StageRow, error)
	// TaskPoolSize returns how many tasks the stage can actually pick:
	// if poolIDs is non-empty → count of poolIDs (assumed already valid);
	// otherwise → count of active mock_tasks for the stage_kind.
	TaskPoolSize(ctx context.Context, stageKind string, poolIDs []uuid.UUID) (int, error)
	// QuestionPoolSize returns active default + active company questions
	// for the stage (HR / behavioral only).
	QuestionPoolSize(ctx context.Context, companyID uuid.UUID, stageKind string) (int, error)
}

// StageRow — minimal projection for validation; mirrors company_stages.
type StageRow struct {
	StageKind          string
	Ordinal            int
	TaskPoolIDs        []uuid.UUID
	StrictnessProfile  *uuid.UUID
}

// ValidatePipeline — UC used by /admin/mock/companies/{id}/validate.
type ValidatePipeline struct {
	Reader PipelineValidatorReader
}

// Do builds the report for a single company.
func (uc *ValidatePipeline) Do(ctx context.Context, companyID uuid.UUID) (ValidationReport, error) {
	stages, err := uc.Reader.StagesForCompany(ctx, companyID)
	if err != nil {
		return ValidationReport{}, fmt.Errorf("admin.ValidatePipeline.stages: %w", err)
	}

	report := ValidationReport{
		CompanyID: companyID.String(),
		Ok:        true,
		Stages:    make([]StageValidation, 0, len(stages)),
	}
	if len(stages) == 0 {
		report.Ok = false
	}

	for _, s := range stages {
		row := StageValidation{
			StageKind:      s.StageKind,
			Ordinal:        s.Ordinal,
			HasStrictness:  s.StrictnessProfile != nil,
			IsTaskSolve:    isTaskSolveKind(s.StageKind),
			IsQuestionPool: isQuestionPoolKind(s.StageKind),
			Errors:         []string{},
		}

		if row.IsTaskSolve {
			n, err := uc.Reader.TaskPoolSize(ctx, s.StageKind, s.TaskPoolIDs)
			if err != nil {
				return ValidationReport{}, fmt.Errorf("admin.ValidatePipeline.tasks: %w", err)
			}
			row.TaskCount = n
			if n == 0 {
				row.Errors = append(row.Errors, "no tasks available for this stage")
			}
		}

		if row.IsQuestionPool {
			n, err := uc.Reader.QuestionPoolSize(ctx, companyID, s.StageKind)
			if err != nil {
				return ValidationReport{}, fmt.Errorf("admin.ValidatePipeline.questions: %w", err)
			}
			row.QuestionCount = n
			if n == 0 {
				row.Errors = append(row.Errors, "no questions in pool (default + company)")
			}
		}

		// Strictness is recommended but not required — the orchestrator
		// falls back to a global default. We mark it as a soft warning by
		// NOT adding to Errors; HasStrictness boolean is exposed для UI
		// чтобы показать "—" indicator.
		if len(row.Errors) > 0 {
			report.Ok = false
		}
		report.Stages = append(report.Stages, row)
	}
	return report, nil
}

func isTaskSolveKind(k string) bool {
	switch k {
	case "algo", "coding", "sysdesign":
		return true
	}
	return false
}

func isQuestionPoolKind(k string) bool {
	switch k {
	case "hr", "behavioral":
		return true
	}
	return false
}
