//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrNotFound is the canonical not-found sentinel for this domain.
var ErrNotFound = errors.New("mock: not found")

// ErrForbidden is returned when the caller tries to touch a session owned by
// another user.
var ErrForbidden = errors.New("mock: forbidden")

// ErrInvalidState is returned when the session is not in a state that allows
// the requested transition (e.g. sending a message to a finished session).
var ErrInvalidState = errors.New("mock: invalid state")

// ─────────────────────────────────────────────────────────────────────────
// Session persistence
// ─────────────────────────────────────────────────────────────────────────

// SessionRepo persists mock_sessions rows.
type SessionRepo interface {
	Create(ctx context.Context, s Session) (Session, error)
	Get(ctx context.Context, id uuid.UUID) (Session, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status string, finishedAt bool) error
	UpdateStress(ctx context.Context, id uuid.UUID, profile StressProfile) error
	UpdateReport(ctx context.Context, id uuid.UUID, reportJSON []byte) error
}

// MessageRepo persists mock_messages rows.
type MessageRepo interface {
	Append(ctx context.Context, msg Message) (Message, error)
	ListLast(ctx context.Context, sessionID uuid.UUID, limit int) ([]Message, error)
	ListAll(ctx context.Context, sessionID uuid.UUID) ([]Message, error)
}

// TaskRepo fetches the interview task for a session. Hint-bearing variant is
// used ONLY when building the LLM system prompt.
type TaskRepo interface {
	PickForSession(ctx context.Context, section string, difficulty string) (TaskWithHint, error)
	GetWithHint(ctx context.Context, id uuid.UUID) (TaskWithHint, error)
}

// CompanyRepo reads the tiny slice of `companies` that the prompt builder needs.
// Kept narrow so ai_mock doesn't depend on any other domain's wide entity.
type CompanyRepo interface {
	Get(ctx context.Context, id uuid.UUID) (CompanyContext, error)
}

// UserRepo reads subscription + preferences so model selection can run.
type UserRepo interface {
	Get(ctx context.Context, id uuid.UUID) (UserContext, error)
}

// ─────────────────────────────────────────────────────────────────────────
// LLM
// ─────────────────────────────────────────────────────────────────────────

// LLMRole is the OpenRouter/OpenAI role value — narrower than MessageRole
// because "tool" is not used yet.
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

// CompletionResponse is the non-streaming result.
type CompletionResponse struct {
	Content    string
	TokensUsed int
	Model      string
}

// Token is a streaming chunk emitted by LLMProvider.Stream.
type Token struct {
	Delta string
	Done  bool
	Err   error
	// TokensUsed is populated on the final chunk (Done=true) when available.
	TokensUsed int
}

// LLMProvider abstracts the OpenRouter client so handlers test against mocks.
type LLMProvider interface {
	Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error)
	Stream(ctx context.Context, req CompletionRequest) (<-chan Token, error)
}

// ─────────────────────────────────────────────────────────────────────────
// Ancillary
// ─────────────────────────────────────────────────────────────────────────

// RateLimiter is a minimal token-bucket abstraction used for per-session LLM
// calls (bible: 10 msg/min per session).
type RateLimiter interface {
	Allow(ctx context.Context, key string, limit int, windowSec int) (allowed bool, retryAfterSec int, err error)
}

// TokenVerifier validates a JWT and returns the authenticated user ID. Owned
// locally so ai_mock/ports doesn't import the auth domain.
type TokenVerifier interface {
	Verify(token string) (uuid.UUID, error)
}
