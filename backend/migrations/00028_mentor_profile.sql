-- +goose Up
-- +goose StatementBegin
--
-- 00028 — Mentor marketplace profile delta + booking table (STRATEGIC SCAFFOLD).
--
-- See docs/strategic/mentor-marketplace.md for the full roadmap.
--
-- We extend `profiles` with five mentor-related columns rather than spinning
-- up a parallel mentor_profiles table because the cardinality is 1:1 and
-- every read path already loads the profile row. Anti-fallback: the booking
-- escrow_state defaults to 'disabled' — no implicit money flow until Phase 2
-- ships Stripe Connect.

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS is_mentor          BOOL    NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS mentor_hourly_rate INT     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mentor_bio         TEXT    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS mentor_languages   TEXT[]  NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS mentor_verified    BOOL    NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_is_mentor
    ON profiles(is_mentor) WHERE is_mentor;

CREATE TABLE IF NOT EXISTS mentor_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentee_id       UUID NOT NULL REFERENCES users(id),
    mentor_id       UUID NOT NULL REFERENCES users(id),
    slot_at         TIMESTAMPTZ NOT NULL,
    duration_min    INT NOT NULL DEFAULT 60,
    status          TEXT NOT NULL DEFAULT 'requested',
    escrow_state    TEXT NOT NULL DEFAULT 'disabled',
    price_cents     INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mentor_sessions_status_valid
        CHECK (status IN ('requested','accepted','completed','disputed','cancelled')),
    CONSTRAINT mentor_sessions_escrow_valid
        CHECK (escrow_state IN ('disabled','held','released','refunded')),
    CONSTRAINT mentor_sessions_distinct_parties
        CHECK (mentee_id <> mentor_id)
);

CREATE INDEX IF NOT EXISTS idx_mentor_sessions_mentor
    ON mentor_sessions(mentor_id, slot_at DESC);

CREATE INDEX IF NOT EXISTS idx_mentor_sessions_mentee
    ON mentor_sessions(mentee_id, slot_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_mentor_sessions_mentee;
DROP INDEX IF EXISTS idx_mentor_sessions_mentor;
DROP TABLE IF EXISTS mentor_sessions;
DROP INDEX IF EXISTS idx_profiles_is_mentor;
ALTER TABLE profiles
    DROP COLUMN IF EXISTS mentor_verified,
    DROP COLUMN IF EXISTS mentor_languages,
    DROP COLUMN IF EXISTS mentor_bio,
    DROP COLUMN IF EXISTS mentor_hourly_rate,
    DROP COLUMN IF EXISTS is_mentor;
-- +goose StatementEnd
