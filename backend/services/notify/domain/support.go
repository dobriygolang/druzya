// support.go — заявки в саппорт из формы /help.
//
// Хранятся в `support_tickets` (см. миграцию 00013). После создания
// notify-bot шлёт alert в support-чат в Telegram (см. SupportBotNotifier
// в ports/support_handler.go).
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// SupportContactKind — куда юзер просит ответ.
type SupportContactKind = string

const (
	SupportContactEmail    SupportContactKind = "email"
	SupportContactTelegram SupportContactKind = "telegram"
)

// SupportStatus — состояние ticket'а.
type SupportStatus = string

const (
	SupportStatusOpen       SupportStatus = "open"
	SupportStatusInProgress SupportStatus = "in_progress"
	SupportStatusResolved   SupportStatus = "resolved"
	SupportStatusClosed     SupportStatus = "closed"
)

// SupportTicket — одна заявка в поддержку.
type SupportTicket struct {
	ID           uuid.UUID
	UserID       *uuid.UUID // nil если анонимная заявка
	ContactKind  SupportContactKind
	ContactValue string
	Subject      string
	Message      string
	Status       SupportStatus
	InternalNote string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	ResolvedAt   *time.Time
}

// SupportRepo хранит ticket'ы.
type SupportRepo interface {
	Create(ctx context.Context, t *SupportTicket) error
	Get(ctx context.Context, id uuid.UUID) (SupportTicket, error)
	// List возвращает страницу ticket'ов отсортированных DESC по created_at.
	// statusFilter == "" — все статусы.
	List(ctx context.Context, statusFilter SupportStatus, limit, offset int) ([]SupportTicket, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status SupportStatus, internalNote string) error
}
