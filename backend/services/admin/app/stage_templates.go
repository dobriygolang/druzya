// stage_templates.go — pipeline templates library.
//
// Two read-only UCs (list + get) plus an Apply that:
//   1. validates template exists,
//   2. replaces the company's stages with the template's stages_json,
//   3. bumps usage_count.
//
// Replace step calls into a cross-context StageReplacer adapter — same
// pattern как PipelineValidatorReader: admin never imports mock_interview
// packages directly.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// StageTemplate — row exposed via /admin/mock/stage-templates.
type StageTemplate struct {
	ID          string          `json:"id"`
	Slug        string          `json:"slug"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	StagesJSON  json.RawMessage `json:"stages_json"`
	UsageCount  int             `json:"usage_count"`
	IsBuiltin   bool            `json:"is_builtin"`
}

// TemplateStage — minimal shape we extract from stages_json для apply.
// Расширяется в будущем (strictness, language pool, …) — пока just kind +
// optional, чтобы builtin templates оставались compact.
type TemplateStage struct {
	Kind     string `json:"kind"`
	Optional bool   `json:"optional"`
}

// StageTemplateRepo — admin/infra impl.
type StageTemplateRepo interface {
	List(ctx context.Context) ([]StageTemplate, error)
	BySlug(ctx context.Context, slug string) (StageTemplate, error)
	BumpUsage(ctx context.Context, id string) error
}

// StageReplacer — cross-context port. admin/infra adapter writes
// directly to company_stages (DROP + INSERT, mirrors the Replace
// pathway used by mock_interview).
type StageReplacer interface {
	ReplaceCompanyStages(ctx context.Context, companyID uuid.UUID, stages []TemplateStage) error
}

// ErrTemplateNotFound used by handler to map → 404.
var ErrTemplateNotFound = errors.New("admin: template not found")

// ListStageTemplates — read-only UC.
type ListStageTemplates struct {
	Repo StageTemplateRepo
}

func (uc *ListStageTemplates) Do(ctx context.Context) ([]StageTemplate, error) {
	out, err := uc.Repo.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin.ListStageTemplates: %w", err)
	}
	return out, nil
}

// ApplyStageTemplate — replace target company's stages with template.
type ApplyStageTemplate struct {
	Repo     StageTemplateRepo
	Replacer StageReplacer
}

// ApplyResult — payload returned to admin UI.
type ApplyResult struct {
	CompanyID    string          `json:"company_id"`
	TemplateSlug string          `json:"template_slug"`
	Stages       []TemplateStage `json:"stages"`
}

func (uc *ApplyStageTemplate) Do(ctx context.Context, companyID uuid.UUID, slug string) (ApplyResult, error) {
	tpl, err := uc.Repo.BySlug(ctx, slug)
	if err != nil {
		return ApplyResult{}, err
	}
	var stages []TemplateStage
	if len(tpl.StagesJSON) > 0 {
		if err := json.Unmarshal(tpl.StagesJSON, &stages); err != nil {
			return ApplyResult{}, fmt.Errorf("admin.ApplyStageTemplate.unmarshal: %w", err)
		}
	}
	if err := uc.Replacer.ReplaceCompanyStages(ctx, companyID, stages); err != nil {
		return ApplyResult{}, fmt.Errorf("admin.ApplyStageTemplate.replace: %w", err)
	}
	if err := uc.Repo.BumpUsage(ctx, tpl.ID); err != nil {
		// non-fatal — лог в handler'е через returned err, но apply уже
		// committed. We propagate чтобы caller мог решить.
		return ApplyResult{
			CompanyID:    companyID.String(),
			TemplateSlug: tpl.Slug,
			Stages:       stages,
		}, fmt.Errorf("admin.ApplyStageTemplate.bumpUsage: %w", err)
	}
	return ApplyResult{
		CompanyID:    companyID.String(),
		TemplateSlug: tpl.Slug,
		Stages:       stages,
	}, nil
}
