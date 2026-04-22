//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// PreferencesRepo сохраняет notification_preferences.
type PreferencesRepo interface {
	// Get загружает строку. Возвращает (zero, ErrNotFound), если строки нет.
	Get(ctx context.Context, userID uuid.UUID) (Preferences, error)
	// Upsert вставляет или обновляет строку.
	Upsert(ctx context.Context, p Preferences) (Preferences, error)
	// SetTelegramChatID обновляет только колонку chat_id — используется /link.
	SetTelegramChatID(ctx context.Context, userID uuid.UUID, chatID string) error
	// ClearTelegramChatID используется /unlink.
	ClearTelegramChatID(ctx context.Context, userID uuid.UUID) error
	// ListWeeklyReportEnabled возвращает user ID (и их chat_id) подписанных
	// на еженедельные отчёты. Используется планировщиком.
	ListWeeklyReportEnabled(ctx context.Context) ([]uuid.UUID, error)
}

// LogRepo сохраняет аудит-лог (notifications_log).
type LogRepo interface {
	Insert(ctx context.Context, e LogEntry) (LogEntry, error)
	// RecentByType возвращает строки по (user_id, type) свежее `since`.
	// Используется для дедупа.
	RecentByType(ctx context.Context, userID uuid.UUID, typ enums.NotificationType, since time.Time) ([]LogEntry, error)
	// MarkSent выставляет строке status=sent с временной меткой отправки.
	MarkSent(ctx context.Context, id uuid.UUID, at time.Time) error
	// MarkFailed выставляет строке status=failed с сообщением об ошибке.
	MarkFailed(ctx context.Context, id uuid.UUID, errMsg string) error
}

// Sender — обобщённый порт исходящего канала. Реализации: TelegramBot,
// SMTPEmail (STUB), WebPush (STUB).
type Sender interface {
	// Channel говорит, какому enum-значению соответствует этот sender.
	Channel() enums.NotificationChannel
	// Send отправляет отрендеренный шаблон пользователю. Если у пользователя нет
	// канал-специфичной идентичности (например, telegram_chat_id пуст), sender
	// ОБЯЗАН вернуть ErrNoTarget — вызывающий использует это, чтобы перейти к
	// следующему каналу, а не зафейлиться.
	Send(ctx context.Context, userID uuid.UUID, chatIdentity string, tpl Template) error
}

// TemplateStore рендерит тройку (type, locale, payload) в сообщение.
type TemplateStore interface {
	Render(typ enums.NotificationType, locale string, payload map[string]any) (Template, error)
}

// Queue — исходящий FIFO: Redis List в проде, in-memory в тестах.
type Queue interface {
	Enqueue(ctx context.Context, n Notification) error
	// Dequeue блокирует, пока не появится элемент или не отменится ctx.
	Dequeue(ctx context.Context) (Notification, error)
}

// RateLimiter обеспечивает бюджет Telegram на пользователя (3/мин по умолчанию).
type RateLimiter interface {
	// Allow возвращает (allowed, retryIn). retryIn > 0, когда тротлится.
	Allow(ctx context.Context, userID uuid.UUID) (bool, time.Duration, error)
}

// UserLookup — узкий read-through в домены auth/profile, используемый
// командой /link бота. Держим узким, чтобы избежать связности.
type UserLookup interface {
	// FindIDByUsername резолвит username в UUID пользователя.
	FindIDByUsername(ctx context.Context, username string) (uuid.UUID, error)
	// GetLocale возвращает предпочитаемую локаль пользователя ("ru"|"en").
	// Отсутствующий пользователь подразумевает "ru" (дефолт по bible).
	GetLocale(ctx context.Context, userID uuid.UUID) (string, error)
}
