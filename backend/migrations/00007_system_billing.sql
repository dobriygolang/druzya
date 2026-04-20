-- +goose Up
-- +goose StatementBegin
CREATE TABLE boosty_accounts (
    user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    boosty_username   TEXT NOT NULL,
    verified_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
    user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan                 TEXT NOT NULL DEFAULT 'free',
    status               TEXT NOT NULL DEFAULT 'active',
    boosty_level         TEXT,
    current_period_end   TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_plan_valid CHECK (plan IN ('free','seeker','ascendant'))
);

CREATE TABLE ai_credits (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance     INT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dynamic_config (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    type        TEXT NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID REFERENCES users(id),
    CONSTRAINT dynconfig_type_valid CHECK (type IN ('int','float','string','bool','json'))
);

CREATE TABLE notifications_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel     TEXT NOT NULL,
    type        TEXT NOT NULL,
    payload     JSONB,
    status      TEXT NOT NULL DEFAULT 'pending',
    sent_at     TIMESTAMPTZ,
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT notify_channel_valid CHECK (channel IN ('telegram','email','push')),
    CONSTRAINT notify_status_valid CHECK (status IN ('pending','sent','failed'))
);

CREATE TABLE notification_preferences (
    user_id                        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    channels                       TEXT[] NOT NULL DEFAULT ARRAY['telegram']::text[],
    telegram_chat_id               TEXT,
    quiet_hours_from               TIME,
    quiet_hours_to                 TIME,
    weekly_report_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    skill_decay_warnings_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE anticheat_signals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_id    UUID REFERENCES arena_matches(id) ON DELETE SET NULL,
    type        TEXT NOT NULL,
    severity    TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT anticheat_severity_valid CHECK (severity IN ('low','medium','high'))
);

CREATE TABLE onboarding_progress (
    user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    step         INT NOT NULL DEFAULT 0,
    answers      JSONB,
    completed_at TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE llm_configs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type   TEXT NOT NULL,
    scope_id     TEXT,
    model        TEXT NOT NULL,
    temperature  NUMERIC(3,2) NOT NULL DEFAULT 0.7,
    max_tokens   INT NOT NULL DEFAULT 2048,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT llm_scope_valid CHECK (scope_type IN ('default','task','section','company','user'))
);

CREATE INDEX idx_notifications_log_user ON notifications_log(user_id, created_at DESC);
CREATE INDEX idx_anticheat_signals_user ON anticheat_signals(user_id, created_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS llm_configs;
DROP TABLE IF EXISTS onboarding_progress;
DROP TABLE IF EXISTS anticheat_signals;
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS notifications_log;
DROP TABLE IF EXISTS dynamic_config;
DROP TABLE IF EXISTS ai_credits;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS boosty_accounts;
-- +goose StatementEnd
