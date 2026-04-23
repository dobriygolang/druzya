-- +goose Up
-- +goose StatementBegin
--
-- 00026 — Weekly killer-stats foundation.
--   - elo_snapshots_daily: daily per-section ELO snapshots, fed by an
--     async job (out of scope here). Used by /report's elo_series widget.
--   - weekly_share_tokens: short-lived public links to a weekly report,
--     30-day expiry, view counter.
--
-- No materialized view: percentiles are computed on demand via window
-- functions in the profile repo (cheap at current scale, simpler ops).

CREATE TABLE IF NOT EXISTS elo_snapshots_daily (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section        TEXT NOT NULL,
    snapshot_date  DATE NOT NULL,
    elo            INT  NOT NULL,
    matches_played INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, section, snapshot_date),
    CONSTRAINT elo_snapshots_section_valid
        CHECK (section IN ('algorithms','sql','go','system_design','behavioral'))
);

CREATE INDEX IF NOT EXISTS idx_elo_snapshots_user_date
    ON elo_snapshots_daily (user_id, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS weekly_share_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_iso    TEXT NOT NULL,
    token       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    views_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_weekly_share_tokens_token
    ON weekly_share_tokens (token);

CREATE INDEX IF NOT EXISTS idx_weekly_share_tokens_user_week
    ON weekly_share_tokens (user_id, week_iso);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_weekly_share_tokens_user_week;
DROP INDEX IF EXISTS idx_weekly_share_tokens_token;
DROP TABLE IF EXISTS weekly_share_tokens;
DROP INDEX IF EXISTS idx_elo_snapshots_user_date;
DROP TABLE IF EXISTS elo_snapshots_daily;
-- +goose StatementEnd
