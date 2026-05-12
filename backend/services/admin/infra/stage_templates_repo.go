// stage_templates_repo.go — R7 Phase 1 templates library + pipeline
// validation adapters. Both impls live here, share the same pgxpool, и
// никаких cross-context imports (mock_interview не трогаем).
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"druz9/admin/app"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─────────────────────────────────────────────────────────────────────────
// Stage Templates
// ─────────────────────────────────────────────────────────────────────────

// StageTemplates is the persistence adapter for the stage_templates table.
type StageTemplates struct {
	pool *pgxpool.Pool
}

// NewStageTemplates wraps a pool.
func NewStageTemplates(pool *pgxpool.Pool) *StageTemplates {
	return &StageTemplates{pool: pool}
}

// Compile-time check.
var _ app.StageTemplateRepo = (*StageTemplates)(nil)

// List returns templates ordered builtin-first, then by name.
func (r *StageTemplates) List(ctx context.Context) ([]app.StageTemplate, error) {
	const q = `
		SELECT id::text, slug, name, description, stages_json, usage_count, is_builtin
		FROM stage_templates
		ORDER BY is_builtin DESC, name ASC
	`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("stage_templates.List: %w", err)
	}
	defer rows.Close()

	out := make([]app.StageTemplate, 0, 8)
	for rows.Next() {
		var t app.StageTemplate
		var raw []byte
		if err := rows.Scan(&t.ID, &t.Slug, &t.Name, &t.Description, &raw, &t.UsageCount, &t.IsBuiltin); err != nil {
			return nil, fmt.Errorf("stage_templates.List.scan: %w", err)
		}
		t.StagesJSON = json.RawMessage(raw)
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("stage_templates.List.rows: %w", err)
	}
	return out, nil
}

// BySlug returns one template — 404 maps to app.ErrTemplateNotFound.
func (r *StageTemplates) BySlug(ctx context.Context, slug string) (app.StageTemplate, error) {
	const q = `
		SELECT id::text, slug, name, description, stages_json, usage_count, is_builtin
		FROM stage_templates WHERE slug = $1
	`
	var t app.StageTemplate
	var raw []byte
	err := r.pool.QueryRow(ctx, q, slug).
		Scan(&t.ID, &t.Slug, &t.Name, &t.Description, &raw, &t.UsageCount, &t.IsBuiltin)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.StageTemplate{}, app.ErrTemplateNotFound
	}
	if err != nil {
		return app.StageTemplate{}, fmt.Errorf("stage_templates.BySlug: %w", err)
	}
	t.StagesJSON = json.RawMessage(raw)
	return t, nil
}

// BumpUsage increments usage_count by 1.
func (r *StageTemplates) BumpUsage(ctx context.Context, id string) error {
	const q = `UPDATE stage_templates SET usage_count = usage_count + 1 WHERE id = $1::uuid`
	if _, err := r.pool.Exec(ctx, q, id); err != nil {
		return fmt.Errorf("stage_templates.BumpUsage: %w", err)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// StageReplacer — direct write into company_stages so admin can apply
// templates without going through mock_interview.
// ─────────────────────────────────────────────────────────────────────────

// StageReplacer adapter — implements app.StageReplacer.
type StageReplacer struct {
	pool *pgxpool.Pool
}

// NewStageReplacer wraps a pool.
func NewStageReplacer(pool *pgxpool.Pool) *StageReplacer { return &StageReplacer{pool: pool} }

// Compile-time check.
var _ app.StageReplacer = (*StageReplacer)(nil)

// ReplaceCompanyStages deletes the company's current stages and inserts
// the supplied list in order. Wrapped in a single tx; defaults match
// company_stages NOT NULL columns (empty arrays for language_pool /
// task_pool_ids).
func (r *StageReplacer) ReplaceCompanyStages(ctx context.Context, companyID uuid.UUID, stages []app.TemplateStage) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("stage_replacer.begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM company_stages WHERE company_id = $1`, companyID); err != nil {
		return fmt.Errorf("stage_replacer.delete: %w", err)
	}

	const insertQ = `
		INSERT INTO company_stages (
			company_id, stage_kind, ordinal, optional,
			language_pool, task_pool_ids, ai_strictness_profile_id,
			default_question_limit, company_question_limit
		) VALUES ($1, $2, $3, $4, '{}'::mock_task_language[], '{}'::uuid[], NULL, NULL, NULL)
	`
	for i, s := range stages {
		if s.Kind == "" {
			return fmt.Errorf("stage_replacer.insert[%d]: empty stage kind", i)
		}
		if _, err := tx.Exec(ctx, insertQ, companyID, s.Kind, i, s.Optional); err != nil {
			return fmt.Errorf("stage_replacer.insert[%d]: %w", i, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("stage_replacer.commit: %w", err)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// PipelineValidatorReader — reads company_stages + count helpers for
// the validation UC.
// ─────────────────────────────────────────────────────────────────────────

// PipelineValidator adapter — implements app.PipelineValidatorReader.
type PipelineValidator struct {
	pool *pgxpool.Pool
}

// NewPipelineValidator wraps a pool.
func NewPipelineValidator(pool *pgxpool.Pool) *PipelineValidator {
	return &PipelineValidator{pool: pool}
}

// Compile-time check.
var _ app.PipelineValidatorReader = (*PipelineValidator)(nil)

// StagesForCompany returns ordered stages for validation.
func (v *PipelineValidator) StagesForCompany(ctx context.Context, companyID uuid.UUID) ([]app.StageRow, error) {
	const q = `
		SELECT stage_kind, ordinal, task_pool_ids, ai_strictness_profile_id
		FROM company_stages
		WHERE company_id = $1
		ORDER BY ordinal ASC
	`
	rows, err := v.pool.Query(ctx, q, companyID)
	if err != nil {
		return nil, fmt.Errorf("validator.stages: %w", err)
	}
	defer rows.Close()

	out := make([]app.StageRow, 0, 5)
	for rows.Next() {
		var (
			r        app.StageRow
			poolRaw  []uuid.UUID
			stricRaw *uuid.UUID
		)
		if err := rows.Scan(&r.StageKind, &r.Ordinal, &poolRaw, &stricRaw); err != nil {
			return nil, fmt.Errorf("validator.stages.scan: %w", err)
		}
		r.TaskPoolIDs = poolRaw
		r.StrictnessProfile = stricRaw
		out = append(out, r)
	}
	return out, rows.Err()
}

// TaskPoolSize: explicit pool list takes precedence; otherwise count
// active mock_tasks by stage_kind. Mirrors orchestrator picker semantics.
func (v *PipelineValidator) TaskPoolSize(ctx context.Context, stageKind string, poolIDs []uuid.UUID) (int, error) {
	if len(poolIDs) > 0 {
		const q = `SELECT count(*) FROM mock_tasks WHERE id = ANY($1) AND active = TRUE`
		var n int
		if err := v.pool.QueryRow(ctx, q, poolIDs).Scan(&n); err != nil {
			return 0, fmt.Errorf("validator.taskPool.explicit: %w", err)
		}
		return n, nil
	}
	const q = `SELECT count(*) FROM mock_tasks WHERE stage_kind = $1 AND active = TRUE`
	var n int
	if err := v.pool.QueryRow(ctx, q, stageKind).Scan(&n); err != nil {
		return 0, fmt.Errorf("validator.taskPool.stage: %w", err)
	}
	return n, nil
}

// QuestionPoolSize: sum of active default + active company questions for
// the stage. Mirrors orchestrator's question picker (which draws from
// both pools subject to per-stage limits — those are not enforced here,
// validation only checks "can the stage even run").
func (v *PipelineValidator) QuestionPoolSize(ctx context.Context, companyID uuid.UUID, stageKind string) (int, error) {
	const q = `
		SELECT
			(SELECT count(*) FROM stage_default_questions WHERE stage_kind = $1 AND active = TRUE) +
			(SELECT count(*) FROM company_questions WHERE company_id = $2 AND stage_kind = $1 AND active = TRUE)
	`
	var n int
	if err := v.pool.QueryRow(ctx, q, stageKind, companyID).Scan(&n); err != nil {
		return 0, fmt.Errorf("validator.questionPool: %w", err)
	}
	return n, nil
}
