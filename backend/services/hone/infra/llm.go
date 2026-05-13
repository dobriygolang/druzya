// Package infra — LLM adapters for Hone.
//
// This file is the entry point: package doc, floor (no-op) adapters,
// shared helpers (firstN / clampScore / truncateRunes / newPlanItemID),
// and the interface-guard block at the bottom.
//
// Per-task adapters live in sibling files:
//   - llm_plan.go      — Daily plan synthesiser (LLMChainPlanSynthesiser)
//   - llm_critique.go  — Whiteboard architecture critique streamer
//   - llm_embed.go     — Ollama embedder wrapper (HoneEmbedder)
//   - llm_reading.go   — Reading summary grader
//   - llm_writing.go   — Writing feedback grader
//   - llm_review.go    — Code review grader
//   - llm_speaking.go  — Speaking pronunciation grader
//
// All real adapters share the same nil-policy: chain MUST be non-nil at
// construction; the wirer falls back to the matching No* floor type when
// llmchain is nil at boot. Anti-fallback: every "not configured" path
// returns a typed error the transport maps to 503 — we NEVER fabricate
// AI output.
package infra

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── Floor adapters (no llmchain) ─────────────────────────────────────────

// NoLLMPlanSynthesiser returns ErrLLMUnavailable on every call. Used when
// llmchain is nil (no provider keys at boot).
type NoLLMPlanSynthesiser struct{}

// NewNoLLMPlanSynthesiser returns the floor adapter.
func NewNoLLMPlanSynthesiser() *NoLLMPlanSynthesiser { return &NoLLMPlanSynthesiser{} }

// Synthesise always returns ErrLLMUnavailable.
func (*NoLLMPlanSynthesiser) Synthesise(_ context.Context, _ uuid.UUID, _ []domain.WeakNode, _ []domain.ChronicSkill, _ domain.TodayContext, _ time.Time) ([]domain.PlanItem, error) {
	return nil, fmt.Errorf("hone.NoLLMPlanSynthesiser.Synthesise: %w", domain.ErrLLMUnavailable)
}

// NoLLMCritiqueStreamer returns ErrLLMUnavailable on every call.
type NoLLMCritiqueStreamer struct{}

// NewNoLLMCritiqueStreamer returns the floor adapter.
func NewNoLLMCritiqueStreamer() *NoLLMCritiqueStreamer { return &NoLLMCritiqueStreamer{} }

// Critique always returns ErrLLMUnavailable.
func (*NoLLMCritiqueStreamer) Critique(_ context.Context, _ []byte, _ func(domain.CritiquePacket) error) error {
	return fmt.Errorf("hone.NoLLMCritiqueStreamer.Critique: %w", domain.ErrLLMUnavailable)
}

// NoEmbedder returns ErrEmbeddingUnavailable on every call.
type NoEmbedder struct{}

// NewNoEmbedder returns the floor adapter.
func NewNoEmbedder() *NoEmbedder { return &NoEmbedder{} }

// Embed always returns ErrEmbeddingUnavailable.
func (*NoEmbedder) Embed(_ context.Context, _ string) ([]float32, string, error) {
	return nil, "", fmt.Errorf("hone.NoEmbedder.Embed: %w", domain.ErrEmbeddingUnavailable)
}

// NoLLMSummaryGrader is the floor adapter for reading summary grading.
// EndReadingSession treats its error as best-effort, so this just punts
// the work — the session is still saved with summary_md, the score stays NULL.
type NoLLMSummaryGrader struct{}

// NewNoLLMSummaryGrader returns the floor adapter.
func NewNoLLMSummaryGrader() *NoLLMSummaryGrader { return &NoLLMSummaryGrader{} }

// GradeSummary always returns ErrLLMUnavailable.
func (*NoLLMSummaryGrader) GradeSummary(_ context.Context, _ domain.GradeSummaryInput) (int, error) {
	return 0, fmt.Errorf("hone.NoLLMSummaryGrader.GradeSummary: %w", domain.ErrLLMUnavailable)
}

// NoLLMWritingGrader is the floor adapter for writing feedback. Use case
// treats the error as user-facing 503; we don't fabricate writing
// feedback under any circumstance.
type NoLLMWritingGrader struct{}

// NewNoLLMWritingGrader returns the floor adapter.
func NewNoLLMWritingGrader() *NoLLMWritingGrader { return &NoLLMWritingGrader{} }

// GradeWriting always returns ErrLLMUnavailable.
func (*NoLLMWritingGrader) GradeWriting(_ context.Context, _ domain.GradeWritingInput) (domain.WritingFeedback, error) {
	return domain.WritingFeedback{}, fmt.Errorf("hone.NoLLMWritingGrader.GradeWriting: %w", domain.ErrLLMUnavailable)
}

// NoLLMCodeReviewGrader returns ErrLLMUnavailable on every call. Use
// case treats the error as user-facing 503 (same convention as the
// writing grader); we never fabricate a review grade.
type NoLLMCodeReviewGrader struct{}

// NewNoLLMCodeReviewGrader returns the floor adapter.
func NewNoLLMCodeReviewGrader() *NoLLMCodeReviewGrader { return &NoLLMCodeReviewGrader{} }

// GradeReview always returns ErrLLMUnavailable.
func (*NoLLMCodeReviewGrader) GradeReview(_ context.Context, _ domain.GradeCodeReviewInput) (domain.CodeReviewFeedback, error) {
	return domain.CodeReviewFeedback{}, fmt.Errorf("hone.NoLLMCodeReviewGrader.GradeReview: %w", domain.ErrLLMUnavailable)
}

// NoLLMSpeakingGrader is the floor adapter. Same nil-policy as the other
// graders — handler maps the typed error to 503; we never fabricate
// pronunciation scores.
type NoLLMSpeakingGrader struct{}

// NewNoLLMSpeakingGrader returns the floor adapter.
func NewNoLLMSpeakingGrader() *NoLLMSpeakingGrader { return &NoLLMSpeakingGrader{} }

// GradeSpeaking always returns ErrLLMUnavailable.
func (*NoLLMSpeakingGrader) GradeSpeaking(_ context.Context, _ domain.SpeakingGraderInput) (domain.SpeakingFeedback, error) {
	return domain.SpeakingFeedback{}, fmt.Errorf("hone.NoLLMSpeakingGrader.GradeSpeaking: %w", domain.ErrLLMUnavailable)
}

// ─── Shared helpers ───────────────────────────────────────────────────────

// firstN truncates s to n characters appending an ellipsis. Used by every
// adapter for log-preview clipping.
func firstN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// newPlanItemID returns a stable 12-char hex ID. LLM-produced IDs collide
// across regenerations — we stamp our own when the model leaves it blank.
func newPlanItemID() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// clampScore clamps a score into [0, 100]. Used by every grader.
func clampScore(v int) int {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

// truncateRunes truncates s to n runes (UTF-8 safe). Used for coach
// feedback caps where byte truncation would corrupt multi-byte chars.
func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// ── interface guards ──────────────────────────────────────────────────────

var (
	_ domain.PlanSynthesizer  = (*NoLLMPlanSynthesiser)(nil)
	_ domain.PlanSynthesizer  = (*LLMChainPlanSynthesiser)(nil)
	_ domain.CritiqueStreamer = (*NoLLMCritiqueStreamer)(nil)
	_ domain.CritiqueStreamer = (*LLMChainCritiqueStreamer)(nil)
	_ domain.Embedder         = (*NoEmbedder)(nil)
	_ domain.Embedder         = (*HoneEmbedder)(nil)
	_ domain.SummaryGrader    = (*NoLLMSummaryGrader)(nil)
	_ domain.SummaryGrader    = (*LLMChainSummaryGrader)(nil)
	_ domain.WritingGrader    = (*NoLLMWritingGrader)(nil)
	_ domain.WritingGrader    = (*LLMChainWritingGrader)(nil)
	_ domain.CodeReviewGrader = (*NoLLMCodeReviewGrader)(nil)
	_ domain.CodeReviewGrader = (*LLMChainCodeReviewGrader)(nil)
	_ domain.SpeakingGrader   = (*NoLLMSpeakingGrader)(nil)
	_ domain.SpeakingGrader   = (*LLMChainSpeakingGrader)(nil)
)
