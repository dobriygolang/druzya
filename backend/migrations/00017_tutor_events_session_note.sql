-- +goose Up
-- +goose StatementBegin

-- 00017_tutor_events_session_note.sql
--
-- Wave 5.2d of docs/feature/plan.md (event completion + session notes).
-- Adds a separate `session_note` column to tutor_events for the tutor's
-- post-session write-up. Distinct from `cancellation_reason` (semantic
-- mismatch — cancellation explains why a session DIDN'T happen; session
-- note records what was covered when it DID).
--
-- Why a new column (vs reusing cancellation_reason as a generic outcome
-- field): keeps the read-side queries trivial. Tutor analytics in 9.5
-- will sum over completed events with non-empty notes — a generic
-- field would force every reader to also check status to disambiguate.

ALTER TABLE tutor_events
    ADD COLUMN IF NOT EXISTS session_note TEXT NOT NULL DEFAULT '';

-- Mirrors the cancellation pair invariant from 00016 — session_note is
-- non-empty iff status='completed'. Defence-in-depth on top of the
-- use case which controls these atomically.
--
-- IF NOT EXISTS guard via DO-block (Postgres ALTER TABLE doesn't support
-- IF NOT EXISTS for ADD CONSTRAINT directly).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'tutor_events_session_note_pair'
    ) THEN
        ALTER TABLE tutor_events
            ADD CONSTRAINT tutor_events_session_note_pair
            CHECK (
                (status = 'completed') OR
                (status <> 'completed' AND session_note = '')
            );
    END IF;
END $$;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive migration; rollback drops the DB (see baseline policy)
-- +goose StatementEnd
