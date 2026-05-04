-- 00073_status_enums.sql — Phase R2: TEXT status поля → ENUM types.
--
-- Plus: type-safety, exhaustive CHECK on insert (Postgres enforces),
-- меньше storage (4 bytes vs variable-length text). Минус: миграция
-- сложнее (DROP-and-RECREATE partial indexes; CAST defaults).
--
-- Конвертируемые таблицы:
--   1. subscriptions.status — values: active|cancelled|expired
--   2. copilot_session_reports.status — values: pending|running|ready|failed
--
-- Skipped:
--   - hone_tasks.status — `WHERE status = ANY($::text[])` в task_repo.go
--     не работает с native ENUM column без явного CAST'а. Конвертация
--     потребовала бы правки Go-кода (ports + repo). Откладываем до
--     отдельной миграции с одновременной правкой layer'а.
--
-- pgx scan/insert в string работает с ENUM прозрачно (driver делает
-- text encoding). Поэтому Go-код для subscriptions/copilot не трогаем.

-- +goose Up
-- +goose StatementBegin

-- ── subscriptions.status ───────────────────────────────────────────────
CREATE TYPE subscription_status AS ENUM ('active', 'cancelled', 'expired');

-- Partial index `idx_subscriptions_plan_active` фильтрует `WHERE status = 'active'`.
-- При ALTER TYPE Postgres требует drop dependant index'ов, потом recreate.
DROP INDEX IF EXISTS idx_subscriptions_plan_active;

ALTER TABLE subscriptions
    ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE subscription_status USING status::subscription_status,
    ALTER COLUMN status SET DEFAULT 'active'::subscription_status;

CREATE INDEX idx_subscriptions_plan_active
    ON subscriptions (plan)
    WHERE status = 'active'::subscription_status;

-- ── copilot_session_reports.status ─────────────────────────────────────
-- Has CHECK constraint copilot_session_reports_status_valid which becomes
-- redundant после ENUM конверсии (ENUM enforces values). Drop it.
CREATE TYPE copilot_report_status AS ENUM ('pending', 'running', 'ready', 'failed');

ALTER TABLE copilot_session_reports
    DROP CONSTRAINT IF EXISTS copilot_session_reports_status_valid;

ALTER TABLE copilot_session_reports
    ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE copilot_report_status USING status::copilot_report_status,
    ALTER COLUMN status SET DEFAULT 'pending'::copilot_report_status;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- ── copilot_session_reports.status revert ──────────────────────────────
ALTER TABLE copilot_session_reports
    ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE TEXT USING status::text,
    ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE copilot_session_reports
    ADD CONSTRAINT copilot_session_reports_status_valid
        CHECK (status IN ('pending','running','ready','failed'));

DROP TYPE IF EXISTS copilot_report_status;

-- ── subscriptions.status revert ────────────────────────────────────────
DROP INDEX IF EXISTS idx_subscriptions_plan_active;

ALTER TABLE subscriptions
    ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE TEXT USING status::text,
    ALTER COLUMN status SET DEFAULT 'active';

CREATE INDEX idx_subscriptions_plan_active
    ON subscriptions (plan) WHERE status = 'active';

DROP TYPE IF EXISTS subscription_status;

-- +goose StatementEnd
