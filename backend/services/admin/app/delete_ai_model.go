package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// DeleteAIModel removes an llm_models row.
type DeleteAIModel struct {
	Models domain.AIModelRepo
}

// Do removes the row identified by modelID.
func (uc *DeleteAIModel) Do(ctx context.Context, modelID string) error {
	if err := uc.Models.Delete(ctx, modelID); err != nil {
		return fmt.Errorf("admin.DeleteAIModel: %w", err)
	}
	return nil
}
