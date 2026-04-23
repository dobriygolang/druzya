-- +goose Up
-- +goose StatementBegin
--
-- 00035 — Onboarding state + focus class on users (Wave-10).
--
-- Adds two columns to users so the new onboarding flow has a real backend
-- to round-trip against (frontend currently tolerates 404s from PUT
-- /profile/me/settings with these fields):
--
--   • onboarding_completed_at TIMESTAMPTZ — NULL = onboarding not yet done.
--     Derived boolean `onboarding_completed` is computed at read time as
--     (onboarding_completed_at IS NOT NULL). Storing the timestamp instead
--     of a bool keeps the audit trail of WHEN the user finished.
--
--   • focus_class TEXT NOT NULL DEFAULT '' — short slug of the user's
--     declared career focus, used to bias atlas/recommendations. Allowed
--     values mirror the frontend onboarding wizard's choice tiles:
--
--         ''           — not yet chosen (default for existing rows)
--         'algo'       — algorithms-heavy track
--         'backend'    — backend engineering track
--         'system'     — system design track
--         'concurrency'— Go concurrency track
--         'ds'         — data structures track
--
--     Enforced via CHECK so a typo from the API cannot land an unknown
--     class — anti-fallback policy. Empty string is preserved as a real
--     value (means «not chosen»), distinct from a bad write (rejected).
--
-- Both columns are nullable / defaulted so the migration is observably a
-- no-op for existing rows. No backfill required.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS focus_class TEXT NOT NULL DEFAULT '';

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_focus_class_valid;

ALTER TABLE users
    ADD CONSTRAINT users_focus_class_valid
        CHECK (focus_class IN ('', 'algo', 'backend', 'system', 'concurrency', 'ds'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_focus_class_valid;

ALTER TABLE users
    DROP COLUMN IF EXISTS focus_class;

ALTER TABLE users
    DROP COLUMN IF EXISTS onboarding_completed_at;
-- +goose StatementEnd
