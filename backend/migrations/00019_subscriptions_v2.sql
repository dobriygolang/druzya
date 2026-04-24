-- +goose Up
-- +goose StatementBegin
-- M1 (2026-04): расширяем существующую таблицу subscriptions под
-- централизованный subscription-сервис. Сохраняем все старые колонки
-- (plan/status/boosty_level/current_period_end/updated_at), чтобы
-- profile/ai_mock/ai_native продолжали работать без изменений.
--
-- Новое:
--   provider         — кто ведёт оплату ('boosty'|'yookassa'|'tbank'|'admin')
--   provider_sub_id  — id подписки у провайдера (для idempotency webhook'ов)
--   started_at       — дата старта подписки (LTV/cohort-аналитика)
--   grace_until      — 24ч после expiry, смягчение Boosty-лага
--
-- boosty_level — оставляем для back-compat, постепенно декоммишнем когда
-- provider+provider_sub_id покроют сценарии (новая схема универсальнее).
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS provider         TEXT,
    ADD COLUMN IF NOT EXISTS provider_sub_id  TEXT,
    ADD COLUMN IF NOT EXISTS started_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS grace_until      TIMESTAMPTZ;

-- CHECK на допустимые provider'ы. NULL допустим (legacy free-планы).
ALTER TABLE subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_provider_valid;
ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_provider_valid
        CHECK (provider IS NULL OR provider IN ('boosty','yookassa','tbank','admin'));

-- UNIQUE защита от webhook-replay: один (provider, provider_sub_id) = один user.
-- Partial потому что legacy rows имеют NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_sub_id
    ON subscriptions (provider, provider_sub_id)
 WHERE provider_sub_id IS NOT NULL;

-- Hot-path индекс для ListByPlan (админская аналитика, периодический
-- Boosty sync). Partial — чтобы индекс не раздувался от cancelled/expired.
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_active
    ON subscriptions (plan)
 WHERE status = 'active';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_subscriptions_plan_active;
DROP INDEX IF EXISTS idx_subscriptions_provider_sub_id;
ALTER TABLE subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_provider_valid,
    DROP COLUMN IF EXISTS grace_until,
    DROP COLUMN IF EXISTS started_at,
    DROP COLUMN IF EXISTS provider_sub_id,
    DROP COLUMN IF EXISTS provider;
-- +goose StatementEnd
