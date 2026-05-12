-- 00108_interview_prep_sessions.sql — Phase J / C6 (P1).
--
-- Cue interview-prep wizard: user uploads CV + JD before going into an
-- interview. Backend parses both via the free LLM chain (Groq → Cerebras
-- → …) and stores the parsed shape here as the "active prep" for the
-- user. Subsequent Cue suggestions / Analyze / Chat consult this row
-- and inject a tailored system block.
--
-- Single-active per user: a partial unique index keeps exactly one
-- ended_at IS NULL row per user. EndInterviewPrep stamps ended_at;
-- StartInterviewPrep first stamps any prior row's ended_at, then
-- inserts the new active row in the same transaction.
--
-- Why a dedicated table (instead of extending cue_sessions.stages jsonb):
--   - cue_sessions is the AFTER-interview ingest target (transcript +
--     ai_summary) — already a coarser unit-of-work. Mixing prep state
--     into it would conflate "what's happening NOW" with "what
--     happened BEFORE".
--   - Per-user partial-unique index for the active row is hard to model
--     inside jsonb without trigger ceremony.
--   - History scan ("show my last 5 prep sessions") wants flat columns
--     for company/role, not jsonb projection.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE interview_prep_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- LLM-extracted, immutable after Start. Stored as jsonb so the schema
    -- can evolve (e.g. add a 'languages' field) without a migration —
    -- the Go layer round-trips through ParsedCV / ParsedJD structs.
    parsed_cv       JSONB NOT NULL DEFAULT '{}'::jsonb,
    parsed_jd       JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Raw source kept verbatim so a future re-parse (model upgrade, bug
    -- fix in prompt) doesn't require the user to re-upload. NULL when
    -- the user only supplied parsed input (e.g. via API).
    cv_text         TEXT,
    jd_text         TEXT,

    -- Convenience denormalisation for the active-prep status chip and
    -- the history list. Mirror parsed_jd → company / role for cheap
    -- access. NULL when parser couldn't extract.
    company         TEXT,
    role            TEXT,

    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL = currently active. EndInterviewPrep stamps a wall-clock
    -- timestamp; the partial unique index below enforces "one active
    -- prep per user".
    ended_at        TIMESTAMPTZ
);

-- Single-active-per-user invariant. The partial WHERE limits the unique
-- constraint to rows that haven't been ended yet, so a user can have
-- many historical rows but only one live one.
CREATE UNIQUE INDEX interview_prep_sessions_active_uniq
    ON interview_prep_sessions(user_id)
    WHERE ended_at IS NULL;

-- History listing index — newest-first for the future "past prep" tab.
CREATE INDEX interview_prep_sessions_user_recent
    ON interview_prep_sessions(user_id, started_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS interview_prep_sessions;

-- +goose StatementEnd
