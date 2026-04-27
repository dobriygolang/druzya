package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// UpdateAIModel partially updates an llm_models row.
type UpdateAIModel struct {
	Models domain.AIModelRepo
}

// Do updates the row identified by modelID.
func (uc *UpdateAIModel) Do(ctx context.Context, modelID string, in domain.AIModelUpsert) (domain.AIModel, error) {
	if modelID == "" {
		return domain.AIModel{}, fmt.Errorf("admin.UpdateAIModel: %w: model_id required", domain.ErrInvalidInput)
	}
	out, err := uc.Models.Update(ctx, modelID, in)
	if err != nil {
		return domain.AIModel{}, fmt.Errorf("admin.UpdateAIModel: %w", err)
	}
	return out, nil
}
