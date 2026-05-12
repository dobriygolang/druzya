-- 00107_telemetry_consent.sql — Phase J / X3 (P1) opt-in analytics consent.
--
-- Why a table not just a profile column? Two reasons:
--   1. Per-surface opt-in. Cue (stealth product) defaults OPT-OUT even if
--      web/hone opt-in is set. A single boolean on users wouldn't capture
--      this — the table lets each surface live in its own row.
--   2. Audit trail. updated_at lets us prove "user opted in on date X"
--      which matters for GDPR-style data export requests.
--
-- Row shape: one row per (user_id, surface) tuple. Surface is one of
-- 'web' | 'hone' | 'cue', mirroring telemetry_events.surface CHECK.
-- opted_in=true means «client may send events from this surface»; the
-- telemetry RecordEvents UC validates server-side too (so a misbehaving
-- client can't override the user's choice).
--
-- Default behaviour when no row exists:
--   - web/hone — default OPT-IN-with-banner (frontend shows consent banner
--     on first session; user can opt-out via Settings, which inserts a
--     row with opted_in=false). Until the user dismisses the banner, the
--     client doesn't fire events.
--   - cue — default OPT-OUT (stealth product). Client doesn't fire events
--     until the user explicitly opt-ins in Settings.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE telemetry_consent (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    surface    TEXT NOT NULL CHECK (surface IN ('hone', 'cue', 'web')),
    opted_in   BOOLEAN NOT NULL,
    -- consent_version — bumped when the consent prompt copy changes
    -- materially (e.g. we start sending events to a new processor).
    -- Forces a fresh prompt on next session when version stored < latest.
    consent_version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, surface)
);

CREATE INDEX idx_telemetry_consent_surface
    ON telemetry_consent(surface, opted_in)
    WHERE opted_in = true;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_telemetry_consent_surface;
DROP TABLE IF EXISTS telemetry_consent;

-- +goose StatementEnd
