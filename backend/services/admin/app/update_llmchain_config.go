package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
	"druz9/shared/pkg/llmchain"
)

// UpdateLLMChainConfig persists a new runtime config under optimistic
// version locking.
type UpdateLLMChainConfig struct {
	Source domain.LLMChainConfigRepo
}

// Do persists cfg if expectedVersion matches the row's current version.
func (uc *UpdateLLMChainConfig) Do(ctx context.Context, cfg *llmchain.RuntimeConfig, expectedVersion int64) error {
	if err := uc.Source.Save(ctx, cfg, expectedVersion); err != nil {
		return fmt.Errorf("admin.UpdateLLMChainConfig: %w", err)
	}
	return nil
}
