// stripe_repo.go — Postgres-адаптер для stripe_customers + stripe_subscriptions
// (миграция 00095). Использует raw pgxpool — таблицы узкие, sqlc-codegen overkill.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StripeRepo — реализация domain.StripeRepo.
type StripeRepo struct {
	pool *pgxpool.Pool
}

// NewStripeRepo — конструктор.
func NewStripeRepo(pool *pgxpool.Pool) *StripeRepo {
	return &StripeRepo{pool: pool}
}

// Compile-time.
var _ domain.StripeRepo = (*StripeRepo)(nil)

func (r *StripeRepo) GetCustomer(ctx context.Context, userID uuid.UUID) (domain.StripeCustomer, error) {
	const q = `
		SELECT user_id, stripe_customer_id, created_at
		  FROM stripe_customers
		 WHERE user_id = $1`
	row := r.pool.QueryRow(ctx, q, userID)
	var out domain.StripeCustomer
	if err := row.Scan(&out.UserID, &out.StripeCustomerID, &out.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.StripeCustomer{}, domain.ErrNotFound
		}
		return domain.StripeCustomer{}, fmt.Errorf("subscription.stripe.GetCustomer: %w", err)
	}
	return out, nil
}

func (r *StripeRepo) UpsertCustomer(ctx context.Context, c domain.StripeCustomer) error {
	const q = `
		INSERT INTO stripe_customers (user_id, stripe_customer_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE
		   SET stripe_customer_id = EXCLUDED.stripe_customer_id`
	if _, err := r.pool.Exec(ctx, q, c.UserID, c.StripeCustomerID); err != nil {
		return fmt.Errorf("subscription.stripe.UpsertCustomer: %w", err)
	}
	return nil
}

// UpsertSubscription — идемпотентная запись по stripe_subscription_id.
// Если запись уже существует — обновляем status / period_end / cancel_at_period_end
// + updated_at. id+user_id сохраняются прежними.
func (r *StripeRepo) UpsertSubscription(ctx context.Context, s domain.StripeSubscription) error {
	const q = `
		INSERT INTO stripe_subscriptions (
			user_id, stripe_subscription_id, stripe_price_id,
			status, current_period_end, cancel_at_period_end, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, now())
		ON CONFLICT (stripe_subscription_id) DO UPDATE
		   SET stripe_price_id      = COALESCE(NULLIF(EXCLUDED.stripe_price_id, ''), stripe_subscriptions.stripe_price_id),
		       status               = EXCLUDED.status,
		       current_period_end   = COALESCE(EXCLUDED.current_period_end, stripe_subscriptions.current_period_end),
		       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
		       updated_at           = now()`
	var cpe *time.Time
	if s.CurrentPeriodEnd != nil {
		cpe = s.CurrentPeriodEnd
	}
	if _, err := r.pool.Exec(ctx, q,
		s.UserID, s.StripeSubscriptionID, s.StripePriceID,
		s.Status, cpe, s.CancelAtPeriodEnd,
	); err != nil {
		return fmt.Errorf("subscription.stripe.UpsertSubscription: %w", err)
	}
	return nil
}

// HasAnySubscription — true если для юзера есть хоть одна row в
// stripe_subscriptions (включая canceled). Используется для гейтинга
// «first-time trial» — даём 7 дней trial только тем, кто никогда не
// подписывался; refunds/cancellations не открывают второй trial-цикл.
func (r *StripeRepo) HasAnySubscription(ctx context.Context, userID uuid.UUID) (bool, error) {
	const q = `SELECT EXISTS(SELECT 1 FROM stripe_subscriptions WHERE user_id = $1)`
	var ok bool
	if err := r.pool.QueryRow(ctx, q, userID).Scan(&ok); err != nil {
		return false, fmt.Errorf("subscription.stripe.HasAnySubscription: %w", err)
	}
	return ok, nil
}

// MarkWebhookSeen — INSERT в stripe_webhook_events с idempotent semantics.
// Возвращает (true, nil) — first-time event (обработать), (false, nil) —
// event уже видели (silent skip). На любом DB-error возвращает (false, err).
func (r *StripeRepo) MarkWebhookSeen(ctx context.Context, eventID, eventType string) (bool, error) {
	if eventID == "" {
		// Empty event_id значит Stripe не положил его в payload — не
		// идемпотентим, пусть UC сам решает.
		return true, nil
	}
	const q = `
		INSERT INTO stripe_webhook_events (event_id, event_type)
		VALUES ($1, $2)
		ON CONFLICT (event_id) DO NOTHING`
	cmd, err := r.pool.Exec(ctx, q, eventID, eventType)
	if err != nil {
		return false, fmt.Errorf("subscription.stripe.MarkWebhookSeen: %w", err)
	}
	return cmd.RowsAffected() == 1, nil
}

// GetActiveSubscriptionByUser — последняя active/trialing подписка юзера.
// Index `stripe_subs_user_active(user_id, status)` помогает.
func (r *StripeRepo) GetActiveSubscriptionByUser(ctx context.Context, userID uuid.UUID) (domain.StripeSubscription, error) {
	const q = `
		SELECT id, user_id, stripe_subscription_id, stripe_price_id,
		       status, current_period_end, cancel_at_period_end,
		       created_at, updated_at
		  FROM stripe_subscriptions
		 WHERE user_id = $1
		   AND status IN ('active', 'trialing')
		 ORDER BY updated_at DESC
		 LIMIT 1`
	row := r.pool.QueryRow(ctx, q, userID)
	var (
		out domain.StripeSubscription
		cpe *time.Time
	)
	if err := row.Scan(
		&out.ID, &out.UserID, &out.StripeSubscriptionID, &out.StripePriceID,
		&out.Status, &cpe, &out.CancelAtPeriodEnd,
		&out.CreatedAt, &out.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.StripeSubscription{}, domain.ErrNotFound
		}
		return domain.StripeSubscription{}, fmt.Errorf("subscription.stripe.GetActiveSubscriptionByUser: %w", err)
	}
	out.CurrentPeriodEnd = cpe
	return out, nil
}
