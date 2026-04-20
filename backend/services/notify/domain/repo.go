//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// PreferencesRepo persists notification_preferences.
type PreferencesRepo interface {
	// Get loads a row. Returns (zero, ErrNotFound) if the row doesn't exist.
	Get(ctx context.Context, userID uuid.UUID) (Preferences, error)
	// Upsert inserts or updates the row.
	Upsert(ctx context.Context, p Preferences) (Preferences, error)
	// SetTelegramChatID updates only the chat_id column — used by /link.
	SetTelegramChatID(ctx context.Context, userID uuid.UUID, chatID string) error
	// ClearTelegramChatID is used by /unlink.
	ClearTelegramChatID(ctx context.Context, userID uuid.UUID) error
	// ListWeeklyReportEnabled returns user IDs (and their chat_ids) subscribed
	// to weekly reports. Used by the scheduler.
	ListWeeklyReportEnabled(ctx context.Context) ([]uuid.UUID, error)
}

// LogRepo persists the audit trail (notifications_log).
type LogRepo interface {
	Insert(ctx context.Context, e LogEntry) (LogEntry, error)
	// RecentByType returns rows matching (user_id, type) newer than `since`.
	// Used for dedup.
	RecentByType(ctx context.Context, userID uuid.UUID, typ enums.NotificationType, since time.Time) ([]LogEntry, error)
	// MarkSent updates a row to status=sent with the send timestamp.
	MarkSent(ctx context.Context, id uuid.UUID, at time.Time) error
	// MarkFailed updates a row to status=failed with an error message.
	MarkFailed(ctx context.Context, id uuid.UUID, errMsg string) error
}

// Sender is the generic outbound channel port. Implementations: TelegramBot,
// SMTPEmail (STUB), WebPush (STUB).
type Sender interface {
	// Channel identifies which enum value this sender satisfies.
	Channel() enums.NotificationChannel
	// Send dispatches a rendered template to the user. If the user has no
	// channel-specific identity (e.g. telegram_chat_id is empty) the sender
	// MUST return ErrNoTarget — the caller uses that to fall through to the
	// next channel, not to error.
	Send(ctx context.Context, userID uuid.UUID, chatIdentity string, tpl Template) error
}

// TemplateStore renders a (type, locale, payload) triple into a message.
type TemplateStore interface {
	Render(typ enums.NotificationType, locale string, payload map[string]any) (Template, error)
}

// Queue is the outbound FIFO — a Redis List in production, in-memory in tests.
type Queue interface {
	Enqueue(ctx context.Context, n Notification) error
	// Dequeue blocks until an item is available or ctx is cancelled.
	Dequeue(ctx context.Context) (Notification, error)
}

// RateLimiter enforces the per-user Telegram budget (3/min default).
type RateLimiter interface {
	// Allow returns (allowed, retryIn). retryIn is >0 when throttled.
	Allow(ctx context.Context, userID uuid.UUID) (bool, time.Duration, error)
}

// UserLookup is a minimal read-through into the auth/profile domains used by
// the bot's /link command. We keep it narrow to avoid coupling.
type UserLookup interface {
	// FindIDByUsername resolves a username to a user UUID.
	FindIDByUsername(ctx context.Context, username string) (uuid.UUID, error)
	// GetLocale returns the user's preferred locale ("ru"|"en"). Missing user
	// implies "ru" (default per bible).
	GetLocale(ctx context.Context, userID uuid.UUID) (string, error)
}
