package app

import (
	"context"
	"fmt"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

func (h *Handlers) GetCompanyStages(ctx context.Context, companyID uuid.UUID) ([]domain.CompanyStage, error) {
	out, err := h.CompanyStages.GetForCompany(ctx, companyID)
	if err != nil {
		return nil, fmt.Errorf("companyStages.GetForCompany: %w", err)
	}
	return out, nil
}

func (h *Handlers) UpsertCompanyStage(ctx context.Context, s domain.CompanyStage) error {
	if s.CompanyID == uuid.Nil || !s.StageKind.Valid() {
		return fmt.Errorf("company_id/stage_kind required: %w", domain.ErrValidation)
	}
	if s.LanguagePool == nil {
		s.LanguagePool = []domain.TaskLanguage{}
	}
	for _, l := range s.LanguagePool {
		if !l.Valid() {
			return fmt.Errorf("language_pool entry %q invalid: %w", l, domain.ErrValidation)
		}
	}
	if s.TaskPoolIDs == nil {
		s.TaskPoolIDs = []uuid.UUID{}
	}
	if err := h.CompanyStages.Upsert(ctx, s); err != nil {
		return fmt.Errorf("companyStages.Upsert: %w", err)
	}
	return nil
}

func (h *Handlers) DeleteCompanyStage(ctx context.Context, companyID uuid.UUID, stage domain.StageKind) error {
	if err := h.CompanyStages.Delete(ctx, companyID, stage); err != nil {
		return fmt.Errorf("companyStages.Delete: %w", err)
	}
	return nil
}

// ReplaceCompanyStages — admin "save stage config" UX. Wipes existing
// rows for the company and writes the provided slice transactionally.
func (h *Handlers) ReplaceCompanyStages(ctx context.Context, companyID uuid.UUID, stages []domain.CompanyStage) error {
	if companyID == uuid.Nil {
		return fmt.Errorf("company_id required: %w", domain.ErrValidation)
	}
	for i := range stages {
		stages[i].CompanyID = companyID
		if !stages[i].StageKind.Valid() {
			return fmt.Errorf("stage[%d].stage_kind invalid: %w", i, domain.ErrValidation)
		}
		if stages[i].LanguagePool == nil {
			stages[i].LanguagePool = []domain.TaskLanguage{}
		}
		if stages[i].TaskPoolIDs == nil {
			stages[i].TaskPoolIDs = []uuid.UUID{}
		}
	}
	if err := h.CompanyStages.ReplaceAll(ctx, companyID, stages); err != nil {
		return fmt.Errorf("companyStages.ReplaceAll: %w", err)
	}
	return nil
}
