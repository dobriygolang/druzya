//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrNotFound is the canonical not-found sentinel for this domain.
var ErrNotFound = errors.New("native: not found")

// ErrForbidden is returned when the caller tries to touch a session owned by
// another user.
var ErrForbidden = errors.New("native: forbidden")

// ErrInvalidState is returned when the round is not in a state that allows
// the requested transition (e.g. verifying on a finished session, or
// finishing without any verification event — Verification Gate, bible §19.1).
var ErrInvalidState = errors.New("native: invalid state")

// ─────────────────────────────────────────────────────────────────────────
// Session / provenance persistence
// ─────────────────────────────────────────────────────────────────────────

// SessionRepo persists native_sessions rows.
type SessionRepo interface {
	Create(ctx context.Context, s Session) (Session, error)
	Get(ctx context.Context, id uuid.UUID) (Session, error)
	UpdateScores(ctx context.Context, id uuid.UUID, scores Scores) error
	// MarkFinished stamps finished_at=now() and writes the final scores.
	MarkFinished(ctx context.Context, id uuid.UUID, scores Scores) error
}

// ProvenanceRepo persists native_provenance rows.
type ProvenanceRepo interface {
	Insert(ctx context.Context, r ProvenanceRecord) (ProvenanceRecord, error)
	Get(ctx context.Context, id uuid.UUID) (ProvenanceRecord, error)
	List(ctx context.Context, sessionID uuid.UUID) ([]ProvenanceRecord, error)
	MarkVerified(ctx context.Context, id uuid.UUID, newKind string) error
}

// TaskRepo fetches the interview task for a session. Hint-bearing variant is
// used ONLY when building the LLM system prompt — never leaked to clients.
type TaskRepo interface {
	PickForSession(ctx context.Context, section string, difficulty string) (TaskWithHint, error)
	GetWithHint(ctx context.Context, id uuid.UUID) (TaskWithHint, error)
}

// UserRepo reads subscription + preferences so model selection can run.
type UserRepo interface {
	Get(ctx context.Context, id uuid.UUID) (UserContext, error)
}

// ─────────────────────────────────────────────────────────────────────────
// LLM — ai_native-specific (no import from ai_mock by design).
// ─────────────────────────────────────────────────────────────────────────

// LLMRole is the OpenRouter/OpenAI role value.
type LLMRole string

const (
	LLMRoleSystem    LLMRole = "system"
	LLMRoleUser      LLMRole = "user"
	LLMRoleAssistant LLMRole = "assistant"
)

// LLMMessage is one chat-completions message.
type LLMMessage struct {
	Role    LLMRole
	Content string
}

// CompletionRequest is the provider-agnostic call shape.
type CompletionRequest struct {
	Model       string
	Messages    []LLMMessage
	Temperature float64
	MaxTokens   int
}

// CompletionResponse is the non-streaming result. ContainsTrap is set by
// the TrapInjector wrapper when the response was substituted; the raw
// OpenRouter adapter always returns false.
type CompletionResponse struct {
	Content      string
	TokensUsed   int
	Model        string
	ContainsTrap bool
	TrapID       string
}

// LLMProvider abstracts the OpenRouter client so handlers test against mocks.
// Unlike ai_mock, ai_native doesn't need streaming — the assistant response is
// presented whole to the user so they can evaluate it.
type LLMProvider interface {
	Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error)
}

// ─────────────────────────────────────────────────────────────────────────
// Hallucination traps
// ─────────────────────────────────────────────────────────────────────────

// TrapStore is the catalog of curated hallucination traps. The in-memory
// implementation (infra/traps.go) is the MVP.
//
// STUB: replace with a CMS-backed repo once we model traps as first-class
// DB content.
type TrapStore interface {
	// Pick returns a trap matching the user's prompt + section, or
	// (HallucinationTrap{}, false) if no trap fits. The implementation is free
	// to be deterministic or randomised.
	Pick(prompt string, section string) (HallucinationTrap, bool)
	All() []HallucinationTrap
}

// ─────────────────────────────────────────────────────────────────────────
// TokenVerifier — used by ports for WebSocket auth (unused in MVP, declared
// for consistency with ai_mock).
// ─────────────────────────────────────────────────────────────────────────

// TokenVerifier validates a JWT and returns the authenticated user ID.
type TokenVerifier interface {
	Verify(token string) (uuid.UUID, error)
}
