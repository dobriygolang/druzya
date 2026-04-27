package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// ListAIModels lists every llm_models row (admin write surface).
type ListAIModels struct {
	Models domain.AIModelRepo
}

// Do returns every model.
func (uc *ListAIModels) Do(ctx context.Context) ([]domain.AIModel, error) {
	out, err := uc.Models.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin.ListAIModels: %w", err)
	}
	return out, nil
}
