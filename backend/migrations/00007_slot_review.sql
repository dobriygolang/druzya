-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00007 slot marketplace + bidirectional reviews + interviewer apps
-- Consolidated from: 00005_guild_slots (slot/booking/review parts),
--   00047_slot_meet_url, 00048_review_service, 00049_interviewer_applications,
--   00050_review_direction
-- ============================================================

CREATE TABLE slots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interviewer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    starts_at       TIMESTAMPTZ NOT NULL,
    duration_min    INT NOT NULL,
    section         TEXT NOT NULL,
    difficulty      TEXT,
    language        TEXT NOT NULL DEFAULT 'ru',
    price_rub       INT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'available',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    meet_url        TEXT,
    CONSTRAINT slots_section_valid CHECK (section IN ('algorithms','sql','go','system_design','behavioral')),
    CONSTRAINT slots_status_valid  CHECK (status IN ('available','booked','completed','cancelled','no_show'))
);
CREATE INDEX idx_slots_status_starts ON slots(status, starts_at);

CREATE TABLE bookings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id       UUID NOT NULL UNIQUE REFERENCES slots(id) ON DELETE CASCADE,
    candidate_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meet_url      TEXT,
    status        TEXT NOT NULL DEFAULT 'confirmed',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_candidate ON bookings(candidate_id);

-- Reviews: originally slot_reviews (1-per-booking, candidate→interviewer).
-- Now bidirectional — composite PK (booking_id, direction) allows two rows
-- per booking. subject_id denormalised for the public profile card lookup
-- on either side (candidate or interviewer).
CREATE TABLE reviews (
    booking_id     UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    direction      TEXT NOT NULL DEFAULT 'candidate_to_interviewer',
    reviewer_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating         INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    feedback       TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (booking_id, direction),
    CONSTRAINT reviews_direction_valid
        CHECK (direction IN ('candidate_to_interviewer', 'interviewer_to_candidate'))
);
CREATE INDEX idx_reviews_subject ON reviews(subject_id, created_at DESC);

-- Interviewer applications (admin-moderated queue)
CREATE TABLE interviewer_applications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    motivation    TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'pending',
    reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at   TIMESTAMPTZ,
    decision_note TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT interviewer_applications_status_valid
        CHECK (status IN ('pending','approved','rejected'))
);
CREATE UNIQUE INDEX interviewer_applications_one_pending
    ON interviewer_applications(user_id) WHERE status = 'pending';
CREATE INDEX interviewer_applications_status_created
    ON interviewer_applications(status, created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;
-- +goose StatementEnd
