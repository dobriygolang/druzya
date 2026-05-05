package infra

import (
	"context"
	"log/slog"

	"druz9/notify/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// WebPushSender implements the web-push channel as a noop sink.
//
// NOTE: noop sink. Production использует TG bot вместо webpush — VAPID
// keys + subscription endpoint pipeline не подключены намеренно. Сохраняем
// слой Sender чтобы worker fan-out имел NotificationChannelPush adapter и
// route fall-through был тривиальным.
type WebPushSender struct {
	log *slog.Logger
}

// NewWebPushSender returns a noop sender (no VAPID dispatch).
func NewWebPushSender(log *slog.Logger) *WebPushSender {
	return &WebPushSender{log: log}
}

// Channel implements domain.Sender.
func (w *WebPushSender) Channel() enums.NotificationChannel { return enums.NotificationChannelPush }

// Send logs rather than dispatching.
func (w *WebPushSender) Send(ctx context.Context, userID uuid.UUID, subscription string, tpl domain.Template) error {
	if subscription == "" {
		return domain.ErrNoTarget
	}
	w.log.InfoContext(ctx, "notify.webpush.stub.send",
		slog.String("user_id", userID.String()),
		slog.Int("text_len", len(tpl.Text)),
	)
	return nil
}

// Compile-time assertion.
var _ domain.Sender = (*WebPushSender)(nil)
