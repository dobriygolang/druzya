package domain

import (
	"context"

	"druz9/shared/pkg/llmchain"
)

// LLMChainConfigRepo is the persistence contract for the singleton
// llm_runtime_config row. It mirrors llmchain.ConfigSource so the same
// type can be passed straight into llmchain.LoaderOptions.
type LLMChainConfigRepo interface {
	Load(ctx context.Context) (*llmchain.RuntimeConfig, error)
	Save(ctx context.Context, cfg *llmchain.RuntimeConfig, expectedVersion int64) error
}
