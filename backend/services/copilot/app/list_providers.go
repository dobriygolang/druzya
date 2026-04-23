package app

import (
	"context"
	"fmt"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// ListProviders implements GET /api/v1/copilot/providers.
//
// Returns the model catalogue annotated with per-user availability — each
// model's AvailableOnCurrentPlan is set by intersecting the catalogue id
// with the user's quota's ModelsAllowed list. The plan-agnostic catalogue
// lives in DesktopConfig; this use case does the per-user projection.
type ListProviders struct {
	Config domain.ConfigProvider
	Quotas domain.QuotaRepo
}

// ListProvidersInput validates caller intent.
type ListProvidersInput struct {
	UserID uuid.UUID
}

// ListProvidersOutput is the projected catalogue.
type ListProvidersOutput struct {
	Models []domain.ProviderModel
}

// Do executes the use case.
func (uc *ListProviders) Do(ctx context.Context, in ListProvidersInput) (ListProvidersOutput, error) {
	cfg, err := uc.Config.Load(ctx)
	if err != nil {
		return ListProvidersOutput{}, fmt.Errorf("copilot.ListProviders: load config: %w", err)
	}
	quota, err := uc.Quotas.GetOrInit(ctx, in.UserID)
	if err != nil {
		return ListProvidersOutput{}, fmt.Errorf("copilot.ListProviders: quota: %w", err)
	}

	// Project AvailableOnCurrentPlan for each model. Copy the catalogue so
	// we don't mutate the config provider's cached value.
	models := make([]domain.ProviderModel, len(cfg.Models))
	for i, m := range cfg.Models {
		m.AvailableOnCurrentPlan = quota.IsModelAllowed(m.ID)
		models[i] = m
	}
	return ListProvidersOutput{Models: models}, nil
}
