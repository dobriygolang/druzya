-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00001 auth + users + admin moderation
-- Consolidated from: 00001_init_core, 00010_users_avatar,
--   00011_admin_status, 00032_ai_insight_model, 00035_onboarding_state,
--   00044 (ai_vacancies_model on users), 00046 (ai_default_model on users)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT,
    role            TEXT NOT NULL DEFAULT 'user',
    locale          TEXT NOT NULL DEFAULT 'ru',
    display_name    TEXT,
    avatar_url              TEXT NOT NULL DEFAULT '',
    ai_insight_model        TEXT,
    ai_vacancies_model      TEXT,
    ai_default_model        TEXT,
    onboarding_completed_at TIMESTAMPTZ,
    focus_class             TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_role_valid  CHECK (role IN ('user','interviewer','admin')),
    CONSTRAINT users_focus_class_valid
        CHECK (focus_class IN ('', 'algo', 'backend', 'system', 'concurrency', 'ds'))
);

CREATE INDEX idx_users_username ON users(username);

CREATE TABLE oauth_accounts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider           TEXT NOT NULL,
    provider_user_id   TEXT NOT NULL,
    access_token_enc   BYTEA,
    refresh_token_enc  BYTEA,
    token_expires_at   TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT oauth_provider_valid CHECK (provider IN ('yandex','telegram')),
    UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_oauth_user ON oauth_accounts(user_id);

-- ─── admin / moderation ────────────────────────────────────
CREATE TABLE user_bans (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason        TEXT NOT NULL,
    issued_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ,
    lifted_at     TIMESTAMPTZ,
    lifted_by     UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_user_bans_user ON user_bans(user_id, issued_at DESC);
CREATE UNIQUE INDEX uq_user_bans_active ON user_bans(user_id) WHERE lifted_at IS NULL;

CREATE TABLE user_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason          TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending',
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_reports_status_valid CHECK (status IN ('pending','resolved','dismissed'))
);
CREATE INDEX idx_user_reports_status ON user_reports(status, created_at DESC);
CREATE INDEX idx_user_reports_target ON user_reports(reported_id, created_at DESC);

CREATE TABLE incidents (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at         TIMESTAMPTZ NOT NULL,
    ended_at           TIMESTAMPTZ,
    severity           TEXT NOT NULL,
    title              TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    affected_services  TEXT[] NOT NULL DEFAULT '{}'::text[],
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT incidents_severity_valid CHECK (severity IN ('minor','major','critical'))
);
CREATE INDEX idx_incidents_started ON incidents(started_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;
-- +goose StatementEnd
