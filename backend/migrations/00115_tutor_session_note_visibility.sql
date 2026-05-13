-- +goose Up
-- +goose StatementBegin

-- 00115_tutor_session_note_visibility.sql — Phase K, T4 (P1) 2026-05-13.
--
-- Tutor option to SHARE post-event session note WITH student. Until now
-- `tutor_events.session_note` (added in 00017) was tutor's PRIVATE
-- write-up — never surfaced to the student. User feedback gap: students
-- want a summary / key takeaways / next steps after the session ends.
--
-- Schema decisions:
--   1) `visibility` defaults to 'private' so EXISTING completed events
--      stay private (no accidental retroactive leak). Tutor must opt in
--      per event.
--   2) Two-version model — `session_note` keeps the full private write-up,
--      `shared_content_md` is an optional curated copy for the student.
--      Empty shared_content_md + visibility='shared' means «share the
--      full private note as-is» (server uses session_note when serving
--      the student-facing endpoint). This lets the tutor either share
--      the raw note in one click OR craft a polished version without
--      touching the private original.
--   3) `shared_at` stamps the first transition private→shared. Re-toggling
--      to private doesn't clear it (audit trail — student may have already
--      read the note). Re-share refreshes the timestamp.
--   4) Partial index on shared rows — the student-side
--      ListSharedSessionNotesForStudent is the hot path; rows are scarce
--      (only completed events with opt-in share), so a partial idx is
--      both selective and cheap.

ALTER TABLE tutor_events
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

ALTER TABLE tutor_events
    ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;

ALTER TABLE tutor_events
    ADD COLUMN IF NOT EXISTS shared_content_md TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN tutor_events.shared_content_md IS
    'Optional separate copy for student-facing surface — tutor can edit '
    'shared version without affecting private full note. Empty string '
    'means «share the raw session_note as-is» when visibility=shared.';

-- CHECK constraint — visibility ∈ {'private','shared'} only.
-- Defence-in-depth on top of use-case validation.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'tutor_events_visibility_valid'
    ) THEN
        ALTER TABLE tutor_events
            ADD CONSTRAINT tutor_events_visibility_valid
            CHECK (visibility IN ('private', 'shared'));
    END IF;
END $$;

-- Student-side hot path index. Partial on visibility='shared' + completed
-- so the query «notes shared to me» hits a tight subset without scanning
-- all events. student_id + shared_at DESC matches the most-recent-first
-- list order.
CREATE INDEX IF NOT EXISTS idx_tutor_events_student_shared
    ON tutor_events (student_id, shared_at DESC)
    WHERE visibility = 'shared'
      AND status = 'completed'
      AND student_id IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive migration; rollback drops the DB (see baseline policy)
-- +goose StatementEnd
