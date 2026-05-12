-- 00110_tutor_directory_profiles.sql — Phase K T1 (P0) 2026-05-12.
--
-- Tutor directory MVP. Until now a tutor could only acquire a student via
-- invite_code or InviteByUsername — both flows assume the tutor already
-- knows the student. There was no path for a student to "find a tutor",
-- which capped tutor-side adoption to whoever the tutor manually reaches.
-- This migration adds an opt-in directory: tutors author a public profile
-- (visible=true), students browse + apply, tutor accepts → existing
-- tutor_students relationship is created.
--
-- Identity rule: «free per identity, не marketplace». NO rates, NO hourly
-- price, NO payment fields. Verification badge exists для anti-spam
-- (admin-only flip via UPDATE — no per-row API for MVP) — see verified_at.
--
-- Schema design:
--   • tutor_directory_profiles — one row per user. Defaults shape «empty,
--     invisible» so an INSERT-on-first-edit pattern works without
--     pre-seed. Tutor toggles visible=true когда готов принимать
--     applications.
--   • bio_md / availability_md — markdown blobs. Length caps prevent
--     abuse и keep render predictable (2000 chars ~ 300 words = enough
--     для тутор pitch).
--   • expertise_tags / languages — TEXT[] (predefined-but-not-enum to
--     allow forward-compatible additions через config). Frontend renders
--     only known tags as chips; unknown values displayed as raw labels.
--   • verified_at — TIMESTAMPTZ. NULL=unverified. Admin updates row
--     directly (no SetVerified RPC for MVP — анти-spam exit valve).
--   • application_message — used by ApplyToTutor flow для seed-text
--     отображения тутору в pending applications list.
--
-- Index strategy:
--   • PRIMARY KEY (user_id) — list/edit/upsert all keyed by caller.
--   • idx_tutor_directory_visible (partial WHERE visible=true) — главный
--     запрос ListDirectoryTutors сканит только visible rows; partial
--     index держит его узким.
--   • GIN(expertise_tags) WHERE visible=true — filter chip support («Go
--     senior / ML / English»). Partial так чтобы invisible profiles
--     не раздували inverted index'у.
--
-- tutor_directory_applications: student-initiated request to a tutor.
-- Separate table (not reused TutorInvite) because the direction is
-- inverted — student → tutor вместо tutor → student. Status enum
-- ('pending'/'accepted'/'declined') decoupled from invite states. On
-- accept the use case инсертит соответствующую tutor_students row;
-- decline soft-marks без создания relationship'а.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE tutor_directory_profiles (
    user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    visible              BOOLEAN NOT NULL DEFAULT false,
    bio_md               TEXT NOT NULL DEFAULT '',
    expertise_tags       TEXT[] NOT NULL DEFAULT '{}',
    languages            TEXT[] NOT NULL DEFAULT '{}',
    timezone             TEXT,
    availability_md      TEXT,
    linkedin_url         TEXT,
    github_url           TEXT,
    verified_at          TIMESTAMPTZ,
    application_message  TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT tutor_directory_profiles_bio_len
        CHECK (length(bio_md) <= 2000),
    CONSTRAINT tutor_directory_profiles_app_msg_len
        CHECK (application_message IS NULL OR length(application_message) <= 500)
);

CREATE INDEX idx_tutor_directory_visible
    ON tutor_directory_profiles(visible)
    WHERE visible = true;

CREATE INDEX idx_tutor_directory_expertise
    ON tutor_directory_profiles USING GIN (expertise_tags)
    WHERE visible = true;

-- Student-initiated applications. Status enum is closed: 'pending' on
-- insert, 'accepted'/'declined' on tutor action. Once terminal a row is
-- kept for analytics (no DELETE). UNIQUE (tutor_id, student_id, status)
-- WHERE status='pending' — student cannot spam multiple pending requests
-- to the same tutor, но after a decline they могут try again (status
-- changes, partial unique no longer matches).
CREATE TABLE tutor_directory_applications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tutor_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message     TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT tutor_directory_applications_no_self
        CHECK (tutor_id <> student_id),
    CONSTRAINT tutor_directory_applications_status_valid
        CHECK (status IN ('pending', 'accepted', 'declined')),
    CONSTRAINT tutor_directory_applications_msg_len
        CHECK (length(message) <= 500)
);

-- Tutor's pending queue UI sorts newest-first.
CREATE INDEX idx_tutor_directory_applications_tutor_pending
    ON tutor_directory_applications(tutor_id, created_at DESC)
    WHERE status = 'pending';

-- Student-side check: «have I already applied?» Used by ApplyToTutor UC
-- to short-circuit duplicate submissions.
CREATE UNIQUE INDEX idx_tutor_directory_applications_unique_pending
    ON tutor_directory_applications(tutor_id, student_id)
    WHERE status = 'pending';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_tutor_directory_applications_unique_pending;
DROP INDEX IF EXISTS idx_tutor_directory_applications_tutor_pending;
DROP TABLE IF EXISTS tutor_directory_applications;
DROP INDEX IF EXISTS idx_tutor_directory_expertise;
DROP INDEX IF EXISTS idx_tutor_directory_visible;
DROP TABLE IF EXISTS tutor_directory_profiles;

-- +goose StatementEnd
