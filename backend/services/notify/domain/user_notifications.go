// user_notifications.go — типы для in-app notifications feed.
//
// Это отдельный поток от outbound (email/telegram/push) — то, что
// рендерится на /notifications и в Bell-popup. Outbound остаётся в
// notifications_log + Worker.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// UserNotification — одна in-app запись.
type UserNotification struct {
	ID        int64
	UserID    uuid.UUID
	Channel   string // social|match|guild|system|challenges|wins
	Type      string // короткий ID типа: challenge|win|friend_added|...
	Title     string
	Body      string
	Payload   map[string]any
	Priority  int
	ReadAt    *time.Time
	CreatedAt time.Time
}

// NotificationFilter — параметры list-выборки.
type NotificationFilter struct {
	Channel    string    // пусто — без фильтра
	OnlyUnread bool      // если true — только read_at IS NULL
	Before     time.Time // если != zero — created_at < Before (cursor pagination)
	Limit      int       // max 100, default 50
}

// NotificationPrefs — per-user настройки.
type NotificationPrefs struct {
	UserID         uuid.UUID
	ChannelEnabled map[string]bool
	SilenceUntil   *time.Time
	UpdatedAt      time.Time
}

// IsChannelEnabled — true если pref не задан явно (по умолчанию on) или true.
func (p NotificationPrefs) IsChannelEnabled(ch string) bool {
	if p.ChannelEnabled == nil {
		return true
	}
	v, ok := p.ChannelEnabled[ch]
	if !ok {
		return true
	}
	return v
}

// IsSilenced — true если SilenceUntil > now.
func (p NotificationPrefs) IsSilenced(now time.Time) bool {
	return p.SilenceUntil != nil && p.SilenceUntil.After(now)
}

// UserNotificationRepo — CRUD по user_notifications.
type UserNotificationRepo interface {
	Insert(ctx context.Context, n UserNotification) (UserNotification, error)
	ListByUser(ctx context.Context, uid uuid.UUID, f NotificationFilter) ([]UserNotification, error)
	MarkRead(ctx context.Context, id int64, uid uuid.UUID) error
	MarkAllRead(ctx context.Context, uid uuid.UUID) (int64, error)
	CountUnread(ctx context.Context, uid uuid.UUID) (int, error)
}

// NotificationPrefsRepo — настройки.
type NotificationPrefsRepo interface {
	Get(ctx context.Context, uid uuid.UUID) (NotificationPrefs, error)
	Upsert(ctx context.Context, p NotificationPrefs) (NotificationPrefs, error)
}
