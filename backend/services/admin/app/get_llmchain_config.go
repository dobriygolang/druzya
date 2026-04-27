package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
	"druz9/shared/pkg/llmchain"
)

// GetLLMChainConfig loads the singleton llm_runtime_config row.
type GetLLMChainConfig struct {
	Source domain.LLMChainConfigRepo
}

// Do returns the runtime config.
func (uc *GetLLMChainConfig) Do(ctx context.Context) (*llmchain.RuntimeConfig, error) {
	out, err := uc.Source.Load(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin.GetLLMChainConfig: %w", err)
	}
	return out, nil
}
