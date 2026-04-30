-- +goose Up
-- +goose StatementBegin

-- 00016_tutor_events.sql
--
-- Wave 5.2b of docs/feature/plan.md (Tutor Tier 3 — scheduled events).
-- A tutor authors a calendar event for either:
--   * one specific student (1-on-1 lesson), OR
--   * one circle (group class — V2; schema ready, UI deferred).
--
-- The XOR is enforced at the row level: exactly one of (student_id,
-- circle_id) is non-NULL. V1 only exposes the student_id branch via
-- RPCs / UI; V2 group classes will exercise the circle branch with
-- the existing schema — NO additional migration needed.
--
-- Why a separate table (vs piggybacking on tutor_assignments):
--   * temporal semantics: assignments have due_at (a deadline);
--     events have scheduled_at + duration_min (a fixed window). The
--     student-side surfaces are different (Today list vs calendar).
--   * RSVP / capacity (V2 group classes) doesn't fit on assignments.
--   * cancellation: an event is cancelled with a reason and stops
--     existing on the student's calendar; an assignment is archived
--     and never had a calendar slot to begin with.
--
-- Auth gating mirrors tutor_assignments: rows are owned by the
-- authoring tutor; students see events targeting them OR a circle
-- they're a member of. Per-row WHERE clauses at the SQL gate, no FK
-- to tutor_students because relationships are mutable (end + restart).

CREATE TABLE IF NOT EXISTS tutor_events (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tutor_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Exactly one of (student_id, circle_id) is non-NULL — enforced
    -- by tutor_events_target_xor below. V1: student_id always set.
    student_id    UUID         REFERENCES users(id)    ON DELETE CASCADE,
    circle_id     UUID         REFERENCES circles(id)  ON DELETE CASCADE,
    title         TEXT         NOT NULL,
    body_md       TEXT         NOT NULL DEFAULT '',
    -- TZ-aware timestamp; client picks the user's local time and the
    -- backend stores UTC. UI re-renders in the viewer's TZ.
    scheduled_at  TIMESTAMPTZ  NOT NULL,
    -- Bounded 1..480 minutes (8h max — generous; longer events
    -- typically belong to multi-event series, not a single row).
    duration_min  INT          NOT NULL,
    -- Optional. Free-form so the tutor can paste Zoom/Meet/Telegram-
    -- voice-room URLs without us having to whitelist providers.
    meet_url      TEXT         NOT NULL DEFAULT '',
    -- Capacity is reserved for V2 group classes — null in V1.
    capacity      INT,
    -- 'scheduled' | 'cancelled' | 'completed'. We keep cancelled rows
    -- for audit (and so the student sees «Maria cancelled the lesson»
    -- rather than the slot silently disappearing).
    status        TEXT         NOT NULL DEFAULT 'scheduled',
    cancellation_reason TEXT   NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT tutor_events_title_nonempty
        CHECK (char_length(title) > 0),
    CONSTRAINT tutor_events_status_valid
        CHECK (status IN ('scheduled','cancelled','completed')),
    CONSTRAINT tutor_events_duration_bounded
        CHECK (duration_min > 0 AND duration_min <= 480),
    CONSTRAINT tutor_events_target_xor
        CHECK (
            (student_id IS NOT NULL AND circle_id IS NULL) OR
            (student_id IS NULL     AND circle_id IS NOT NULL)
        ),
    -- Capacity only makes sense for circle (group) events. NULL for
    -- 1-on-1 (V1); positive integer for group (V2).
    CONSTRAINT tutor_events_capacity_circle_only
        CHECK (
            (capacity IS NULL) OR
            (capacity > 0 AND circle_id IS NOT NULL)
        ),
    -- Cancellation reason is set iff status='cancelled'. Defence-in-
    -- depth for the use case which controls these atomically.
    CONSTRAINT tutor_events_cancellation_pair
        CHECK (
            (status = 'cancelled' AND char_length(cancellation_reason) > 0) OR
            (status <> 'cancelled' AND cancellation_reason = '')
        ),
    -- Self-event makes no sense. Even if student_id is null (group),
    -- the tutor can't be in their own circle as a regular member —
    -- but that's a circles-side concern, not enforced here.
    CONSTRAINT tutor_events_self_link
        CHECK (student_id IS NULL OR tutor_id <> student_id)
);

-- Tutor's calendar list — most-recent-scheduled first. Includes
-- cancelled rows (visible in admin / audit views).
CREATE INDEX IF NOT EXISTS idx_tutor_events_tutor_scheduled
    ON tutor_events (tutor_id, scheduled_at DESC);

-- Student-side «my upcoming events» — partial index excludes
-- cancelled so the hot read path on Hone HomePage / Calendar is tight.
CREATE INDEX IF NOT EXISTS idx_tutor_events_student_upcoming
    ON tutor_events (student_id, scheduled_at)
    WHERE status <> 'cancelled' AND student_id IS NOT NULL;

-- Circle-side index for V2 group classes. Reserved.
CREATE INDEX IF NOT EXISTS idx_tutor_events_circle_upcoming
    ON tutor_events (circle_id, scheduled_at)
    WHERE status <> 'cancelled' AND circle_id IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive migration; rollback drops the DB (see baseline policy)
-- +goose StatementEnd
