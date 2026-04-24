//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"errors"
	"time"

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

// ErrServiceUnavailable signals a transient, operator-controlled block
// (kill-switch tripped, dependency down). Maps to HTTP 503 /
// Connect Unavailable; client retries.
var ErrServiceUnavailable = errors.New("copilot: service unavailable")

// ErrInvalidInput is returned for shape violations the server must refuse
// (empty prompt with no attachment, oversized image, etc.).
var ErrInvalidInput = errors.New("copilot: invalid input")

// ErrRateLimited — счётчик в Redis превысил квоту окна. Возвращается
// RateLimiter.Allow и маппится на 429 / Connect CodeResourceExhausted.
// Держим отдельный sentinel в домене copilot — кросс-доменный импорт
// из auth/domain создал бы неоправданную связность.
var ErrRateLimited = errors.New("copilot: rate limited")

// RateLimiter — фикс-windowed счётчик. Интерфейс узкий: реализация живёт в
// copilot/infra и шэрит Redis-клиент с остальным проектом. Используется,
// в частности, в StartSession, чтобы free-tier юзер не мог спамом сжечь
// общий LLM-бюджет.
type RateLimiter interface {
	// Allow инкрементирует счётчик `key` в текущем окне.
	// Возвращает (remaining, retryAfterSec, err). При превышении лимита
	// err = ErrRateLimited, а retryAfterSec — оставшийся TTL окна.
	Allow(ctx context.Context, key string, limit int, window time.Duration) (remaining int, retryAfter int, err error)
}

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
	Delta string // partial assistant content
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

// ─────────────────────────────────────────────────────────────────────────
// Sessions (Phase 12)
// ─────────────────────────────────────────────────────────────────────────

// ErrLiveSessionExists — StartSession was called while one is already open.
// Surfaced to the client as FailedPrecondition so the UI can close/restart.
var ErrLiveSessionExists = errors.New("copilot: a live session already exists")

// SessionRepo persists copilot_sessions rows.
type SessionRepo interface {
	Create(ctx context.Context, userID uuid.UUID, kind SessionKind) (Session, error)
	Get(ctx context.Context, id uuid.UUID) (Session, error)
	// GetLive returns the user's single live session, or ErrNotFound.
	GetLive(ctx context.Context, userID uuid.UUID) (Session, error)
	// End stamps finished_at=now() and is a no-op if already ended.
	// Returns ErrNotFound when the row does not exist or belongs to a
	// different user.
	End(ctx context.Context, id, userID uuid.UUID) error
	// MarkByok sets byok_only=true; once flipped, never unsets.
	MarkByok(ctx context.Context, id uuid.UUID) error
	// ListForUser returns summaries newest-first, keyset paginated.
	ListForUser(ctx context.Context, userID uuid.UUID, kind SessionKind, cursor Cursor, limit int) ([]SessionSummary, Cursor, error)
	// AttachConversation is called by Analyze when a live session exists
	// — stamps session_id onto the just-created conversation row.
	AttachConversation(ctx context.Context, conversationID, sessionID uuid.UUID) error
	// ListConversations returns all conversations the session owns.
	// Used by the analyzer to assemble its input.
	ListConversations(ctx context.Context, sessionID uuid.UUID) ([]Conversation, error)
	// AttachDocument / DetachDocument mutate Session.DocumentIDs in
	// place. Both are idempotent on the DB side (set-like array).
	// Returns ErrNotFound when (sessionID, userID) doesn't match.
	AttachDocument(ctx context.Context, sessionID, userID, docID uuid.UUID) error
	DetachDocument(ctx context.Context, sessionID, userID, docID uuid.UUID) error
}

// SessionSummary adds the conversation count to a Session for the
// history list. Matches the ConversationSummary shape in spirit.
type SessionSummary struct {
	Session
	ConversationCount int
}

// ReportRepo persists copilot_session_reports rows.
type ReportRepo interface {
	// Init idempotently creates a pending report row for a session.
	// Called by EndSession so GetSessionAnalysis has something to
	// return while the analyzer works.
	Init(ctx context.Context, sessionID uuid.UUID) (SessionReport, error)
	Get(ctx context.Context, sessionID uuid.UUID) (SessionReport, error)
	// MarkRunning bumps status from pending → running and stamps
	// started_at. A no-op if the row is already in a terminal state.
	MarkRunning(ctx context.Context, sessionID uuid.UUID) error
	// Write commits a successful analyzer result → status=ready.
	Write(ctx context.Context, sessionID uuid.UUID, r AnalyzerResult, reportURL string) error
	// Fail commits an analyzer error → status=failed.
	Fail(ctx context.Context, sessionID uuid.UUID, errMsg string) error
}

// Analyzer turns an AnalyzerInput into an AnalyzerResult. Implementation
// is LLM-backed (see infra/llm_analyzer.go); the interface keeps app
// layer testable against a deterministic fake.
type Analyzer interface {
	Analyze(ctx context.Context, in AnalyzerInput) (AnalyzerResult, error)
}
