-- 00100_stripe_webhook_dedup.sql — Stripe webhook idempotency.
--
-- Stripe retries delivery до 3 days если webhook возвращает не-2xx или
-- timeout. Без dedup table мы рискуем дважды зачислить tier на одну
-- и ту же оплату.
--
-- Контракт UC HandleWebhookEvent: INSERT event_id; on conflict — silent skip.
-- Stripe event_id (evt_...) гарантированно уникален per-event.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    event_id    TEXT PRIMARY KEY,
    event_type  TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index по received_at — для cleanup-job (через 90+ дней события точно
-- больше не пригодятся; Stripe всё равно retry'ит максимум 3 дня).
CREATE INDEX IF NOT EXISTS stripe_webhook_events_received
    ON stripe_webhook_events(received_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS stripe_webhook_events_received;
DROP TABLE IF EXISTS stripe_webhook_events;

-- +goose StatementEnd
