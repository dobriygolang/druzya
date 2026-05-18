package infra

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"druz9/shared/pkg/llmcache"
)

// ErrEmbedderDisabled — bootstrap не получил OLLAMA_HOST, embedder
// сконструирован как nil-adapter. Caller (SendMessage / Compact) ловит
// эту ошибку и деградирует в legacy ranked recall.
var ErrEmbedderDisabled = errors.New("ai_tutor: embedder disabled (OLLAMA_HOST not set)")

// Embedder оборачивает llmcache.OllamaEmbedder под domain.Embedder.
// Тот же клиент что Hone использует для notes — bge-m3, 1024-dim,
// L2-normalised. Held by-value, nil-receiver safe.
type Embedder struct {
	under *llmcache.OllamaEmbedder
	model string
}

// NewEmbedder создаёт adapter. host="" → nil-возврат, caller знает что
// embedding disabled. Для prod expected: NewEmbedder("http://ollama:11434", "").
func NewEmbedder(host, model string) *Embedder {
	if strings.TrimSpace(host) == "" {
		return nil
	}
	if model == "" {
		model = llmcache.DefaultOllamaEmbedModel
	}
	return &Embedder{
		under: llmcache.NewOllamaEmbedder(host, model, 0),
		model: model,
	}
}

// Embed — вызов Ollama embed endpoint. Респект контексту (timeout); пустой
// текст → no-op чтобы не жечь HTTP-вызов на trivial input.
func (e *Embedder) Embed(ctx context.Context, text string) ([]float32, string, error) {
	if e == nil || e.under == nil {
		return nil, "", ErrEmbedderDisabled
	}
	if strings.TrimSpace(text) == "" {
		return nil, "", nil
	}
	vec, err := e.under.Embed(ctx, text)
	if err != nil {
		return nil, "", fmt.Errorf("ai_tutor.Embedder.Embed: %w", err)
	}
	return vec, e.model, nil
}
