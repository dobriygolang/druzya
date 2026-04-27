package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// ListPublicAIModels powers GET /api/v1/ai/models — public read-through
// over the catalogue.
type ListPublicAIModels struct {
	Models domain.AIModelRepo
}

// Do returns the active catalogue, optionally narrowed by use surface.
func (uc *ListPublicAIModels) Do(ctx context.Context, f domain.PublicAIModelFilter) ([]domain.PublicAIModel, error) {
	out, err := uc.Models.ListPublic(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("admin.ListPublicAIModels: %w", err)
	}
	return out, nil
}
