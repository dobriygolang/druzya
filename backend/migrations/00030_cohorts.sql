-- +goose Up
-- +goose StatementBegin
--
-- 00030 — Cohorts: time-boxed group preparation (STRATEGIC SCAFFOLD).
--
-- See docs/strategic/cohorts.md for the full roadmap, including the
-- argument for a separate bounded context vs extending `guild`.
--
-- Three tables:
--   - cohorts: time-boxed grouping with a definite end date
--   - cohort_members: membership rows (role: member|coach|owner)
--   - cohort_invites: short-lived multi-use invite tokens
--
-- Anti-fallback: leaderboard rendering MUST return [] for empty cohorts;
-- never pad with platform averages.

CREATE TABLE IF NOT EXISTS cohorts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    owner_id     UUID NOT NULL REFERENCES users(id),
    starts_at    TIMESTAMPTZ NOT NULL,
    ends_at      TIMESTAMPTZ NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active',
    visibility   TEXT NOT NULL DEFAULT 'invite',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cohorts_status_valid
        CHECK (status IN ('active','graduated','cancelled')),
    CONSTRAINT cohorts_visibility_valid
        CHECK (visibility IN ('invite','public')),
    CONSTRAINT cohorts_window_valid
        CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS cohort_members (
    cohort_id    UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member',
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at      TIMESTAMPTZ,
    PRIMARY KEY (cohort_id, user_id),
    CONSTRAINT cohort_members_role_valid
        CHECK (role IN ('member','coach','owner'))
);

CREATE INDEX IF NOT EXISTS idx_cohort_members_user
    ON cohort_members(user_id);

CREATE TABLE IF NOT EXISTS cohort_invites (
    token       TEXT PRIMARY KEY,
    cohort_id   UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    max_uses    INT  NOT NULL DEFAULT 1,
    used_count  INT  NOT NULL DEFAULT 0,
    CONSTRAINT cohort_invites_uses_valid CHECK (used_count >= 0 AND used_count <= max_uses)
);

CREATE INDEX IF NOT EXISTS idx_cohort_invites_cohort
    ON cohort_invites(cohort_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_cohort_invites_cohort;
DROP TABLE IF EXISTS cohort_invites;
DROP INDEX IF EXISTS idx_cohort_members_user;
DROP TABLE IF EXISTS cohort_members;
DROP TABLE IF EXISTS cohorts;
-- +goose StatementEnd
