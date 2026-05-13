// Package infra — embedder adapter for memory + retrieval.
//
// Wraps llmcache.OllamaEmbedder. See llm.go for shared helpers and the
// NoEmbedder floor type.
package infra

import (
	"context"
	"fmt"
	"strings"

	"druz9/hone/domain"
	"druz9/shared/pkg/llmcache"
)

// ─── HoneEmbedder (wraps llmcache.OllamaEmbedder) ─────────────────────────

// HoneEmbedder adapts llmcache.OllamaEmbedder to domain.Embedder. The
// underlying client already handles retries, timeouts, and L2 normalisation;
// we just tack on a (model, "") return and a typed ErrEmbeddingUnavailable
// for empty-host config.
type HoneEmbedder struct {
	under *llmcache.OllamaEmbedder
	model string
}

// NewHoneEmbedder constructs the embedder. `host` is the OLLAMA_HOST config
// value; empty host ⇒ nil embedder returned ⇒ caller must use NoEmbedder
// instead. `model` defaults to llmcache.DefaultOllamaEmbedModel when empty.
func NewHoneEmbedder(host, model string) *HoneEmbedder {
	if strings.TrimSpace(host) == "" {
		return nil
	}
	if model == "" {
		model = llmcache.DefaultOllamaEmbedModel
	}
	return &HoneEmbedder{
		under: llmcache.NewOllamaEmbedder(host, model, 0),
		model: model,
	}
}

// Embed delegates to the underlying Ollama client.
func (e *HoneEmbedder) Embed(ctx context.Context, text string) ([]float32, string, error) {
	if e == nil || e.under == nil {
		return nil, "", fmt.Errorf("hone.HoneEmbedder.Embed: %w", domain.ErrEmbeddingUnavailable)
	}
	vec, err := e.under.Embed(ctx, text)
	if err != nil {
		return nil, "", fmt.Errorf("hone.HoneEmbedder.Embed: %w", err)
	}
	return vec, e.model, nil
}
