//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"errors"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ErrNotFound is the canonical not-found sentinel for this domain.
var ErrNotFound = errors.New("copilot: not found")

// ErrForbidden is returned when the caller tries to touch a resource owned
// by another user.
var ErrForbidden = errors.New("copilot: forbidden")

// ErrQuotaExceeded is returned when the user has spent their request bucket
// and the window has not yet reset. Callers should surface retry_after to
// the client.
var ErrQuotaExceeded = errors.New("copilot: quota exceeded")

// ErrModelNotAllowed is returned when the requested model is outside the
// user's plan allow-list.
var ErrModelNotAllowed = errors.New("copilot: model not allowed on current plan")

// ErrInvalidInput is returned for shape violations the server must refuse
// (empty prompt with no attachment, oversized image, etc.).
var ErrInvalidInput = errors.New("copilot: invalid input")

// Cursor is the opaque keyset-pagination token for ListHistory. Empty value
// means "first page"; the repo layer re-encodes a non-empty cursor from the
// ConversationSummary cursor fields.
type Cursor string

// ─────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────

// ConversationRepo persists copilot_conversations rows.
type ConversationRepo interface {
	Create(ctx context.Context, userID uuid.UUID, title, model string) (Conversation, error)
	Get(ctx context.Context, id uuid.UUID) (Conversation, error)
	UpdateTitle(ctx context.Context, id uuid.UUID, title string) error
	Touch(ctx context.Context, id uuid.UUID) error
	Delete(ctx context.Context, id, userID uuid.UUID) error
	// ListForUser returns up to `limit` summaries ordered by updated_at DESC.
	// An empty cursor returns the first page.
	ListForUser(ctx context.Context, userID uuid.UUID, cursor Cursor, limit int) ([]ConversationSummary, Cursor, error)
}

// MessageRepo persists copilot_messages rows.
type MessageRepo interface {
	Insert(ctx context.Context, m Message) (Message, error)
	// UpdateAssistant commits the final streaming content + token usage
	// onto a placeholder row created at stream start.
	UpdateAssistant(ctx context.Context, id uuid.UUID, content string, tokensIn, tokensOut, latencyMs int) error
	List(ctx context.Context, conversationID uuid.UUID) ([]Message, error)
	Rate(ctx context.Context, messageID uuid.UUID, rating int8) error
	// OwnerOf returns the user_id of the conversation that owns a message.
	// Used to guard Rate before it runs.
	OwnerOf(ctx context.Context, messageID uuid.UUID) (uuid.UUID, error)
}

// QuotaRepo persists copilot_quotas rows. Get-or-lazy-create is encapsulated
// in GetOrInit so the app layer doesn't juggle two calls.
type QuotaRepo interface {
	GetOrInit(ctx context.Context, userID uuid.UUID) (Quota, error)
	IncrementUsage(ctx context.Context, userID uuid.UUID) error
	ResetWindow(ctx context.Context, userID uuid.UUID) error
	UpdatePlan(ctx context.Context, userID uuid.UUID, plan enums.SubscriptionPlan, cap int, modelsAllowed []string) error
}

// ─────────────────────────────────────────────────────────────────────────
// LLM
// ─────────────────────────────────────────────────────────────────────────

// LLMMessage is one chat-completions message. Images are passed as data URIs
// embedded in the OpenAI "image_url" content part — the provider implementation
// is responsible for that encoding. Here we keep a simple shape so the domain
// doesn't know about wire formats.
type LLMMessage struct {
	Role    enums.MessageRole
	Content string
	// Images are raw bytes with a MIME type. Empty slice == text-only turn.
	Images []LLMImage
}

// LLMImage is a single image input to the LLM. Kept as bytes because we do
// not persist images and the provider layer converts to data-URI at the
// last possible moment.
type LLMImage struct {
	MimeType string
	Data     []byte
}

// CompletionRequest is the provider-agnostic streaming call shape.
type CompletionRequest struct {
	Model       string
	Messages    []LLMMessage
	Temperature float64
	MaxTokens   int
}

// StreamEvent is one frame from a streaming LLM response. Exactly one of
// Delta / Done / Err is populated per frame.
type StreamEvent struct {
	Delta string         // partial assistant content
	Done  *CompletionDone
	Err   error
}

// CompletionDone is the final frame with token accounting.
type CompletionDone struct {
	TokensIn  int
	TokensOut int
	Model     string // echo of actual model used (may differ from request on fallback)
}

// LLMProvider abstracts the OpenRouter client (or any other) for handlers.
// Stream emits token deltas until a final Done or Err; the channel closes
// after the terminal frame.
type LLMProvider interface {
	Stream(ctx context.Context, req CompletionRequest) (<-chan StreamEvent, error)
}

// ─────────────────────────────────────────────────────────────────────────
// Remote config
// ─────────────────────────────────────────────────────────────────────────

// ConfigProvider serves the DesktopConfig payload. Implementations may be
// file-backed, DB-backed, or remote. The Rev field on the returned config
// must be monotonically increasing.
type ConfigProvider interface {
	// Load returns the full current config. Callers that hold a rev can
	// compare against the returned config's rev to decide whether to
	// propagate the change to clients.
	Load(ctx context.Context) (DesktopConfig, error)
}
