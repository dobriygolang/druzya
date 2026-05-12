package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Repo — persistence port для subscription'ов. Две конкретные реализации:
// Postgres (prod) и in-memory (тесты).
type Repo interface {
	// Get возвращает текущую строку. ErrNotFound когда юзер никогда не
	// появлялся в subscriptions.
	Get(ctx context.Context, userID uuid.UUID) (Subscription, error)

	// Upsert — идемпотентная запись по (user_id). Используется Admin'ом
	// (ручная выдача) и будущим Boosty-sync worker'ом (M3).
	Upsert(ctx context.Context, sub Subscription) error

	// ListByPlan — пагинируемая выборка для admin-dashboard'а и Boosty-sync.
	// Обёртывает только status='active' (см. partial index).
	ListByPlan(ctx context.Context, tier Tier, limit, offset int) ([]Subscription, error)

	// MarkExpired ставит status='expired' всем с grace_until < now.
	// Вызывается периодически cron'ом (раз в час). Возвращает число обновлённых.
	MarkExpired(ctx context.Context, now time.Time) (int64, error)

	// ListExpiringTrials возвращает users on admin-granted trial Pro,
	// у которых current_period_end лежит в окне (from, until]. Used cron
	// notify_trial_expiring (раз в день) чтобы предупредить юзеров за 24h
	// до конца trial'а. Возвращает только status='active' rows.
	ListExpiringTrials(ctx context.Context, from, until time.Time, limit int) ([]Subscription, error)
}

// Clock — test-seam. Производственная реализация — time.Now; тесты
// инжектят детерминированный источник.
type Clock interface {
	Now() time.Time
}

// RealClock — production-клок в UTC.
type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now().UTC() }
