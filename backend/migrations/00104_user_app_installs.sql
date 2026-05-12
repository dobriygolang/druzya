-- 00104_user_app_installs.sql — Phase J / X1 (P0) single onboarding funnel.
--
-- Backs the install-tracking + cross-app suggestion + first-week trial Pro flow.
-- Web signup → Hone CTA → first focus session → Cue CTA. We need to know
-- which surfaces a given user has actually launched (vs just signed up to
-- web) so the cross-promotion fires once, in the right direction.
--
-- Three rows per power user (web + hone + cue). last_seen_at refreshes on
-- every heartbeat — used by the cross-app banner to decide "show suggestion"
-- vs "user already installed". first_seen_at is immutable (set on first
-- insert via ON CONFLICT DO UPDATE that excludes it).
--
-- Trial Pro reuse: see backend/services/subscription/app/grant_trial_pro.go —
-- when the first row across (web, hone, cue) lands for a free-tier user, we
-- flip subscriptions to plan='pro' with current_period_end = now() + 7 days
-- + provider='admin'. The MarkExpired cron auto-reverts after the period.
-- No new column on subscriptions: the existing schema is sufficient.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE user_app_installs (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app            TEXT NOT NULL,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    app_version    TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, app),
    CONSTRAINT user_app_installs_app_valid CHECK (app IN ('web', 'hone', 'cue'))
);

-- Per-user lookup (GetInstalledApps): single user fetches all rows. The PK
-- already covers (user_id, app) but a separate (user_id) prefix index isn't
-- redundant — Postgres uses the PK for both, no extra index needed.

-- Cohort queries: «how many users actually launched Hone last 7 days».
CREATE INDEX idx_user_app_installs_last_seen
    ON user_app_installs(app, last_seen_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_user_app_installs_last_seen;
DROP TABLE IF EXISTS user_app_installs;

-- +goose StatementEnd
