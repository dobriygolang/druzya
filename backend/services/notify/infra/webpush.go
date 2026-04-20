package infra

import (
	"context"
	"log/slog"

	"druz9/notify/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// WebPushSender implements the web-push channel as a STUB.
//
// STUB: real implementation will use github.com/SherClockHolmes/webpush-go
// with VAPID keys and subscriptions stored per-user. Not in MVP scope
// (bible §3.11: PWA push is Phase 2).
type WebPushSender struct {
	log *slog.Logger
}

// NewWebPushSender returns a stub.
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
