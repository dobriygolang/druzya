// speaking_stt.go — Phase J / H4 (P1) Speaking STT floor adapter.
//
// Real STT lives в transcription bounded context (Groq Whisper). Hone
// services don't import other services — the real adapter is wired
// in monolith bootstrap (cmd/monolith/services/hone/speaking.go) which
// has access to both contexts.
//
// Here we only ship the no-op floor: returns ErrLLMUnavailable so the
// handler maps to 503 when STT is unwired.
package infra

import (
	"context"
	"fmt"

	"druz9/hone/domain"
)

// NoSpeakingSTT is the floor adapter — returns ErrLLMUnavailable
// (Hone uses the same sentinel for both LLM and STT unavailability;
// callers don't distinguish at the wire layer).
type NoSpeakingSTT struct{}

// NewNoSpeakingSTT returns the floor adapter.
func NewNoSpeakingSTT() *NoSpeakingSTT { return &NoSpeakingSTT{} }

// Transcribe always returns ErrLLMUnavailable.
func (*NoSpeakingSTT) Transcribe(_ context.Context, _ domain.STTInput) (domain.STTResult, error) {
	return domain.STTResult{}, fmt.Errorf("hone.NoSpeakingSTT: %w", domain.ErrLLMUnavailable)
}

// ── interface guard ──────────────────────────────────────────────────────

var _ domain.SpeakingSTT = (*NoSpeakingSTT)(nil)
