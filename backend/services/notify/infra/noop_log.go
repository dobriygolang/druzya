package infra

import (
	"context"
	"time"

	"druz9/notify/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// NoopLogRepo is the v2 stub for domain.LogRepo. The notifications_log
// table was dropped in schema_v2 (it was an event-log nobody read), but
// the LogRepo interface stays in the domain so SendNotification/Worker
// can pretend send-attempts are recorded. Insert returns a zero LogEntry,
// RecentByType always returns the empty slice (so dedup never finds a
// duplicate — Telegram-bot rate limiter handles flood protection in
// Redis instead), and Mark* methods are no-ops.
type NoopLogRepo struct{}

// NewNoopLogRepo constructs the stub.
func NewNoopLogRepo() *NoopLogRepo { return &NoopLogRepo{} }

// Insert returns the entry as-is with a fresh id; nothing is persisted.
func (NoopLogRepo) Insert(_ context.Context, e domain.LogEntry) (domain.LogEntry, error) {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now().UTC()
	}
	return e, nil
}

// RecentByType always returns an empty slice (dedup-free).
func (NoopLogRepo) RecentByType(_ context.Context, _ uuid.UUID, _ enums.NotificationType, _ time.Time) ([]domain.LogEntry, error) {
	return nil, nil
}

// MarkSent is a no-op.
func (NoopLogRepo) MarkSent(_ context.Context, _ uuid.UUID, _ time.Time) error { return nil }

// MarkFailed is a no-op.
func (NoopLogRepo) MarkFailed(_ context.Context, _ uuid.UUID, _ string) error { return nil }

var _ domain.LogRepo = (*NoopLogRepo)(nil)
