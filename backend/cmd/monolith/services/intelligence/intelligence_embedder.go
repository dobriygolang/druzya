package intelligence

import (
	"context"
	"fmt"
	"log/slog"

	monolithServices "druz9/cmd/monolith/services"
	intelDomain "druz9/intelligence/domain"
	"druz9/shared/pkg/llmcache"
)

// ─── Embedder shim ────────────────────────────────────────────────────────

// intelEmbedder — тонкая обёртка над llmcache.OllamaEmbedder с типизированной
// ErrEmbeddingUnavailable. bge-m3 — generic shared-infra (используется и в
// hone, и в documents).
type intelEmbedder struct {
	model string
	emb   *llmcache.OllamaEmbedder
}

func newIntelEmbedder(d monolithServices.Deps) intelDomain.Embedder {
	host := ""
	if d.Cfg != nil {
		host = d.Cfg.LLMChain.OllamaHost
	}
	if host == "" {
		d.Log.Warn("intelligence: OLLAMA_HOST not set — ask-notes will return 503")
		return &intelEmbedder{} // emb==nil → Embed returns ErrEmbeddingUnavailable
	}
	d.Log.Info("intelligence: Ollama embedder wired", slog.String("ollama_host", host))
	return &intelEmbedder{
		model: llmcache.DefaultOllamaEmbedModel,
		emb:   llmcache.NewOllamaEmbedder(host, llmcache.DefaultOllamaEmbedModel, 0),
	}
}

func (e *intelEmbedder) Embed(ctx context.Context, text string) ([]float32, string, error) {
	if e == nil || e.emb == nil {
		return nil, "", fmt.Errorf("intelligence.intelEmbedder.Embed: %w", intelDomain.ErrEmbeddingUnavailable)
	}
	vec, err := e.emb.Embed(ctx, text)
	if err != nil {
		return nil, "", fmt.Errorf("intelligence.intelEmbedder.Embed: %w", err)
	}
	return vec, e.model, nil
}
