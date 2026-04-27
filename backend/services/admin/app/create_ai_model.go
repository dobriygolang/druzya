package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// CreateAIModel inserts a new llm_models row.
type CreateAIModel struct {
	Models domain.AIModelRepo
}

// Do validates required fields and creates the row.
func (uc *CreateAIModel) Do(ctx context.Context, in domain.AIModelUpsert) (domain.AIModel, error) {
	if in.ModelID == "" || in.Label == "" || in.Provider == "" {
		return domain.AIModel{}, fmt.Errorf("admin.CreateAIModel: %w: model_id, label, provider required", domain.ErrInvalidInput)
	}
	out, err := uc.Models.Create(ctx, in)
	if err != nil {
		return domain.AIModel{}, fmt.Errorf("admin.CreateAIModel: %w", err)
	}
	return out, nil
}
