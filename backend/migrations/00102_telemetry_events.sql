-- 00102_telemetry_events.sql — opt-in product analytics layer.
--
-- Privacy: 90-day retention enforced by background prune job (см. service
-- telemetry/app/prune.go). Aggregate queries only — no per-user export.
-- Table растёт ~1-10K rows/day на active user; partition by occurred_at month
-- если scale >100M rows (deferred).
--
-- Index strategy:
--   - (user_id, occurred_at DESC) — funnel queries по конкретному юзеру
--   - (name, occurred_at DESC)    — aggregate by event-name (cohort, etc.)
--   - GIN(properties)             — ad-hoc property filtering (deferred — JSONB
--                                   GIN добавим когда появятся reporting queries)

-- +goose Up
-- +goose StatementBegin

CREATE TABLE telemetry_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    surface     TEXT NOT NULL CHECK (surface IN ('hone', 'cue', 'web')),
    name        TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 64),
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    properties  JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_telemetry_events_user_occurred
    ON telemetry_events(user_id, occurred_at DESC);

CREATE INDEX idx_telemetry_events_name_occurred
    ON telemetry_events(name, occurred_at DESC);

-- prune helper: BRIN индекс на received_at чтобы DELETE WHERE received_at <
-- now() - 90 days был дешёвым.
CREATE INDEX idx_telemetry_events_received_brin
    ON telemetry_events USING BRIN(received_at);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_telemetry_events_received_brin;
DROP INDEX IF EXISTS idx_telemetry_events_name_occurred;
DROP INDEX IF EXISTS idx_telemetry_events_user_occurred;
DROP TABLE IF EXISTS telemetry_events;

-- +goose StatementEnd
