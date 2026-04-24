-- +goose Up
-- +goose StatementBegin
CREATE TABLE cohorts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name        TEXT NOT NULL UNIQUE,
    emblem      TEXT,
    cohort_elo   INT NOT NULL DEFAULT 1000,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cohort_members (
    cohort_id          UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role              TEXT NOT NULL DEFAULT 'member',
    assigned_section  TEXT,
    joined_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cohort_id, user_id),
    CONSTRAINT cohort_members_role_valid CHECK (role IN ('captain','member')),
    CONSTRAINT cohort_members_section_valid CHECK (assigned_section IS NULL OR assigned_section IN ('algorithms','sql','go','system_design','behavioral'))
);

CREATE UNIQUE INDEX idx_cohort_members_one_cohort ON cohort_members(user_id);

CREATE TABLE cohort_wars (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_a_id   UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    cohort_b_id   UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    week_start   DATE NOT NULL,
    week_end     DATE NOT NULL,
    scores_a     JSONB NOT NULL DEFAULT '{}'::jsonb,
    scores_b     JSONB NOT NULL DEFAULT '{}'::jsonb,
    winner_id    UUID REFERENCES cohorts(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cohort_wars_different CHECK (cohort_a_id <> cohort_b_id)
);

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
    CONSTRAINT slots_section_valid CHECK (section IN ('algorithms','sql','go','system_design','behavioral')),
    CONSTRAINT slots_status_valid CHECK (status IN ('available','booked','completed','cancelled','no_show'))
);

CREATE TABLE bookings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id       UUID NOT NULL UNIQUE REFERENCES slots(id) ON DELETE CASCADE,
    candidate_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meet_url      TEXT,
    status        TEXT NOT NULL DEFAULT 'confirmed',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE slot_reviews (
    booking_id  UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    feedback    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_slots_status_starts ON slots(status, starts_at);
CREATE INDEX idx_bookings_candidate ON bookings(candidate_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS slot_reviews;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS slots;
DROP TABLE IF EXISTS cohort_wars;
DROP TABLE IF EXISTS cohort_members;
DROP TABLE IF EXISTS cohorts;
-- +goose StatementEnd
