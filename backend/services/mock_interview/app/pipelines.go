package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// PipelineWithStages is the read-projection used by Get / Create.
type PipelineWithStages struct {
	Pipeline domain.MockPipeline
	Stages   []domain.PipelineStage
}

// defaultStageOrder — the 5-stage skeleton used in random mode (companyID nil)
// or as a fallback when company_stages is empty.
var defaultStageOrder = []domain.StageKind{
	domain.StageHR,
	domain.StageAlgo,
	domain.StageCoding,
	domain.StageSysDesign,
	domain.StageBehavioral,
}

// CreatePipeline opens a pipeline + skeleton pipeline_stages rows.
//
// Phase A scope: just allocate the rows. The orchestrator (Phase B) is the
// one that picks tasks, prompts the LLM judge, advances stages, etc.
//
// companyID nil ⇢ random mode: use defaultStageOrder.
// companyID set ⇢ pull company_stages config; fall back to default if empty.
func (h *Handlers) CreatePipeline(ctx context.Context, userID uuid.UUID, companyID *uuid.UUID, aiAssist bool) (PipelineWithStages, error) {
	if userID == uuid.Nil {
		return PipelineWithStages{}, fmt.Errorf("user_id required: %w", domain.ErrValidation)
	}

	// Resolve stage order.
	stageKinds, err := h.resolveStageOrder(ctx, companyID)
	if err != nil {
		return PipelineWithStages{}, err
	}

	now := h.Now().UTC()
	pipe, err := h.Pipelines.Create(ctx, domain.MockPipeline{
		ID:              uuid.New(),
		UserID:          userID,
		CompanyID:       companyID,
		AIAssist:        aiAssist,
		CurrentStageIdx: 0,
		Verdict:         domain.PipelineInProgress,
		StartedAt:       now,
	})
	if err != nil {
		return PipelineWithStages{}, fmt.Errorf("pipelines.Create: %w", err)
	}

	stages := make([]domain.PipelineStage, 0, len(stageKinds))
	for i, kind := range stageKinds {
		s, sErr := h.PipelineStages.Create(ctx, domain.PipelineStage{
			ID:         uuid.New(),
			PipelineID: pipe.ID,
			StageKind:  kind,
			Ordinal:    i,
			Status:     domain.StageStatusPending,
		})
		if sErr != nil {
			return PipelineWithStages{}, fmt.Errorf("pipelineStages.Create[%d]: %w", i, sErr)
		}
		stages = append(stages, s)
	}
	return PipelineWithStages{Pipeline: pipe, Stages: stages}, nil
}

func (h *Handlers) resolveStageOrder(ctx context.Context, companyID *uuid.UUID) ([]domain.StageKind, error) {
	if companyID == nil || *companyID == uuid.Nil {
		return defaultStageOrder, nil
	}
	cfgRows, err := h.CompanyStages.GetForCompany(ctx, *companyID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, fmt.Errorf("companyStages.GetForCompany: %w", err)
	}
	if len(cfgRows) == 0 {
		return defaultStageOrder, nil
	}
	// Sort by ordinal — repo SHOULD already return ordered, but make this
	// deterministic so a sloppy adapter can't break orchestration.
	sorted := make([]domain.CompanyStage, len(cfgRows))
	copy(sorted, cfgRows)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].Ordinal < sorted[i].Ordinal {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	out := make([]domain.StageKind, 0, len(sorted))
	for _, s := range sorted {
		out = append(out, s.StageKind)
	}
	return out, nil
}

func (h *Handlers) GetPipeline(ctx context.Context, id uuid.UUID) (PipelineWithStages, error) {
	p, err := h.Pipelines.Get(ctx, id)
	if err != nil {
		return PipelineWithStages{}, fmt.Errorf("pipelines.Get: %w", err)
	}
	stages, err := h.PipelineStages.ListByPipeline(ctx, id)
	if err != nil {
		return PipelineWithStages{}, fmt.Errorf("pipelineStages.ListByPipeline: %w", err)
	}
	return PipelineWithStages{Pipeline: p, Stages: stages}, nil
}

func (h *Handlers) ListPipelinesByUser(ctx context.Context, userID uuid.UUID, limit int) ([]domain.MockPipeline, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	out, err := h.Pipelines.ListByUser(ctx, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("pipelines.ListByUser: %w", err)
	}
	return out, nil
}
