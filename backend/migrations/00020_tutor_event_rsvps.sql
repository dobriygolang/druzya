-- +goose Up
-- +goose StatementBegin

-- 00020_tutor_event_rsvps.sql
--
-- Wave 5.2 — group events on circles. Per-event RSVP table so a circle
-- (group) event with capacity can gate joiners. 1-on-1 events (the V1
-- shape from migration 00016) don't use this table — student is
-- implicit on tutor_events.student_id.
--
-- A composite PRIMARY KEY (event_id, student_id) lets the UI fire a
-- naive INSERT and rely on ON CONFLICT DO NOTHING / SELECT EXISTS for
-- «am I already in?» checks. Capacity is enforced by the use case
-- layer with a SELECT count + INSERT inside a single transaction
-- (per-event row count > capacity → reject).

CREATE TABLE IF NOT EXISTS tutor_event_rsvps (
    event_id    UUID         NOT NULL REFERENCES tutor_events(id) ON DELETE CASCADE,
    student_id  UUID         NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, student_id)
);

-- Hot read: how many people RSVP'd to this event right now.
CREATE INDEX IF NOT EXISTS idx_tutor_event_rsvps_event
    ON tutor_event_rsvps (event_id);

-- Reverse: which events am I in (for student's calendar UNION).
CREATE INDEX IF NOT EXISTS idx_tutor_event_rsvps_student
    ON tutor_event_rsvps (student_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive migration
-- +goose StatementEnd
