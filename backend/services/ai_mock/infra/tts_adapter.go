package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/ai_mock/domain"
)

// TTSAdapter bridges the engine-specific EdgeTTSClient into the engine-
// agnostic domain.TTSClient port. It owns the voice picking logic that
// used to leak into ports.
type TTSAdapter struct {
	Client EdgeTTSClient
}

// NewTTSAdapter wires the adapter. Pass StubEdgeTTSClient{} for the no-op
// path; pass *EdgeTTSClientImpl for the real WS client.
func NewTTSAdapter(c EdgeTTSClient) TTSAdapter {
	return TTSAdapter{Client: c}
}

// Synth maps (voice, lang) → concrete EdgeVoice, calls the upstream client,
// and translates the engine-specific not-implemented sentinel to the
// domain-level one so callers don't need to import infra.
func (a TTSAdapter) Synth(ctx context.Context, text, voice, lang string) ([]byte, error) {
	out, err := a.Client.Synth(ctx, text, PickEdgeVoice(voice, lang))
	if errors.Is(err, ErrEdgeTTSNotImplemented) {
		return nil, domain.ErrTTSNotImplemented
	}
	if err != nil {
		return nil, fmt.Errorf("ai_mock.TTSAdapter.Synth: %w", err)
	}
	return out, nil
}

// Compile-time guard.
var _ domain.TTSClient = TTSAdapter{}
