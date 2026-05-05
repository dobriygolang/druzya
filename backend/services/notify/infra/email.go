package infra

import (
	"context"
	"log/slog"

	"druz9/notify/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// EmailSender is the SMTP-backed Sender for the email channel.
//
// NOTE: stdout sink. Production уведомления идут через TG bot; SMTP не
// подключён намеренно (free-tier, no transactional email vendor). Сохраняем
// сигнатуру + sender чтобы worker fan-out не падал, и чтобы при появлении
// SMTP-провайдера hot-swap прошёл без правок ports/app.
type EmailSender struct {
	log  *slog.Logger
	host string
	port int
	user string
}

// NewEmailSender returns a stdout-logging sender (no SMTP wired).
func NewEmailSender(log *slog.Logger, host string, port int, user string) *EmailSender {
	return &EmailSender{log: log, host: host, port: port, user: user}
}

// Channel implements domain.Sender.
func (e *EmailSender) Channel() enums.NotificationChannel { return enums.NotificationChannelEmail }

// Send logs the message instead of dispatching. If the recipient email is
// empty, returns domain.ErrNoTarget so the worker falls through.
func (e *EmailSender) Send(ctx context.Context, userID uuid.UUID, email string, tpl domain.Template) error {
	if email == "" {
		return domain.ErrNoTarget
	}
	e.log.InfoContext(ctx, "notify.email.stub.send",
		slog.String("user_id", userID.String()),
		slog.String("to", email),
		slog.Int("text_len", len(tpl.Text)),
	)
	return nil
}

// Compile-time assertion.
var _ domain.Sender = (*EmailSender)(nil)
