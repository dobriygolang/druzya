package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// ToggleAIModel flips is_enabled.
type ToggleAIModel struct {
	Models domain.AIModelRepo
}

// Do flips is_enabled and returns the refreshed row.
func (uc *ToggleAIModel) Do(ctx context.Context, modelID string) (domain.AIModel, error) {
	out, err := uc.Models.Toggle(ctx, modelID)
	if err != nil {
		return domain.AIModel{}, fmt.Errorf("admin.ToggleAIModel: %w", err)
	}
	return out, nil
}
