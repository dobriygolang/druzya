-- +goose Up
-- +goose StatementBegin

-- ─────────────────────────────────────────────────────────────────────────
-- user_bans — admin can ban users (temporary or permanent).
-- A row exists IFF the user is currently or was previously banned.
-- expires_at NULL ⇒ permanent ban; otherwise lifted automatically once
-- expires_at < now(). We keep history rows so unban can be audited.
-- ─────────────────────────────────────────────────────────────────────────
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
CREATE INDEX idx_user_bans_user      ON user_bans(user_id, issued_at DESC);
-- A user has only one currently-active ban at a time (lifted_at IS NULL).
CREATE UNIQUE INDEX uq_user_bans_active ON user_bans(user_id) WHERE lifted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- user_reports — moderation queue. Any user can report another user; a
-- moderator marks status='resolved' to clear it from the dashboard.
-- ─────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────
-- incidents — public status page (uptime page). Records production
-- outages / degradations so users can see what's wrong and what got fixed.
-- ─────────────────────────────────────────────────────────────────────────
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
DROP TABLE IF EXISTS incidents;
DROP TABLE IF EXISTS user_reports;
DROP TABLE IF EXISTS user_bans;
-- +goose StatementEnd
