// user_notifications.go — use cases для in-app notifications feed.
//
// Subscribers слушают cross-domain events и пишут UserNotification.Insert.
// HTTP-handler'ы (см. ports) вызывают List/MarkRead/MarkAllRead/Prefs.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/notify/domain"

	"github.com/google/uuid"
)

// ListUserNotifications — GET /notifications.
type ListUserNotifications struct {
	Repo  domain.UserNotificationRepo
	Prefs domain.NotificationPrefsRepo
	Log   *slog.Logger
}

// Do возвращает страницу (всегда non-nil).
func (uc *ListUserNotifications) Do(ctx context.Context, uid uuid.UUID, f domain.NotificationFilter) ([]domain.UserNotification, error) {
	out, err := uc.Repo.ListByUser(ctx, uid, f)
	if err != nil {
		return nil, fmt.Errorf("notify.ListUser: %w", err)
	}
	return out, nil
}

// CountUnread — GET /notifications/unread_count.
type CountUnread struct {
	Repo domain.UserNotificationRepo
}

// Do возвращает unread count.
func (uc *CountUnread) Do(ctx context.Context, uid uuid.UUID) (int, error) {
	n, err := uc.Repo.CountUnread(ctx, uid)
	if err != nil {
		return n, fmt.Errorf("notify.CountUnread: %w", err)
	}
	return n, nil
}

// MarkRead / MarkAllRead обёртки.
type MarkRead struct{ Repo domain.UserNotificationRepo }

// Do mark single.
func (uc *MarkRead) Do(ctx context.Context, id int64, uid uuid.UUID) error {
	if err := uc.Repo.MarkRead(ctx, id, uid); err != nil {
		return fmt.Errorf("notify.MarkRead: %w", err)
	}
	return nil
}

// MarkAllRead обёртка.
type MarkAllRead struct{ Repo domain.UserNotificationRepo }

// Do mark all.
func (uc *MarkAllRead) Do(ctx context.Context, uid uuid.UUID) (int64, error) {
	n, err := uc.Repo.MarkAllRead(ctx, uid)
	if err != nil {
		return n, fmt.Errorf("notify.MarkAllRead: %w", err)
	}
	return n, nil
}

// GetPrefs / UpdatePrefs.
type GetPrefs struct{ Repo domain.NotificationPrefsRepo }

// Do get.
func (uc *GetPrefs) Do(ctx context.Context, uid uuid.UUID) (domain.NotificationPrefs, error) {
	p, err := uc.Repo.Get(ctx, uid)
	if err != nil {
		return p, fmt.Errorf("notify.GetPrefs: %w", err)
	}
	return p, nil
}

// UpdatePrefs upsert + return.
type UpdatePrefs struct{ Repo domain.NotificationPrefsRepo }

// Do upsert.
func (uc *UpdatePrefs) Do(ctx context.Context, p domain.NotificationPrefs) (domain.NotificationPrefs, error) {
	out, err := uc.Repo.Upsert(ctx, p)
	if err != nil {
		return out, fmt.Errorf("notify.UpdatePrefs: %w", err)
	}
	return out, nil
}

// ── Cross-domain subscribers ────────────────────────────────────────────────

// FeedHandlers — обработчики событий, пишущие in-app feed entries.
type FeedHandlers struct {
	Repo  domain.UserNotificationRepo
	Prefs domain.NotificationPrefsRepo
	Log   *slog.Logger
}

// NewFeedHandlers конструктор. log обязателен (anti-fallback policy: no
// silent slog.Default() fallback — wirers must pass an explicit logger).
func NewFeedHandlers(repo domain.UserNotificationRepo, prefs domain.NotificationPrefsRepo, log *slog.Logger) *FeedHandlers {
	if log == nil {
		panic("notify.app.NewFeedHandlers: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &FeedHandlers{Repo: repo, Prefs: prefs, Log: log}
}

// shouldDeliver — true если канал не выключен и не silenced.
func (h *FeedHandlers) shouldDeliver(ctx context.Context, uid uuid.UUID, channel string) bool {
	if h.Prefs == nil {
		return true
	}
	p, err := h.Prefs.Get(ctx, uid)
	if err != nil {
		// fail-open: если prefs недоступны — лучше показать, чем замолчать.
		return true
	}
	if p.IsSilenced(time.Now().UTC()) {
		return false
	}
	return p.IsChannelEnabled(channel)
}
