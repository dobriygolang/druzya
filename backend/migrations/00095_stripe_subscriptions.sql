-- 00095_stripe_subscriptions.sql — Stripe checkout MVP (Stream C completion).
--
-- Параллельно с существующей subscriptions table (которая хранит canonical
-- tier per-user) добавляем durable хранение Stripe state:
--   stripe_customers     — мэппинг user → stripe customer_id (lazy create на первом checkout)
--   stripe_subscriptions — текущие активные/canceled подписки (нужны для cancel UC + webhook idempotency)
--
-- После прихода webhook'а checkout.session.completed или customer.subscription.updated
-- UC дёргает SetTier(userID, Pro) — subscriptions table остаётся источником
-- правды для GetTier / CheckTier. Эти две Stripe-таблицы — внутренний state
-- для billing-домена.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE IF NOT EXISTS stripe_customers (
    user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT UNIQUE NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stripe_subscriptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_subscription_id  TEXT UNIQUE NOT NULL,
    stripe_price_id         TEXT NOT NULL,
    -- 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'unpaid'
    status                  TEXT NOT NULL,
    current_period_end      TIMESTAMPTZ,
    cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stripe_subs_user_active
    ON stripe_subscriptions(user_id, status);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS stripe_subs_user_active;
DROP TABLE IF EXISTS stripe_subscriptions;
DROP TABLE IF EXISTS stripe_customers;

-- +goose StatementEnd
