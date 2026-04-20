-- +goose Up
-- +goose StatementBegin
CREATE TABLE daily_streaks (
    user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak   INT NOT NULL DEFAULT 0,
    longest_streak   INT NOT NULL DEFAULT 0,
    freeze_tokens    INT NOT NULL DEFAULT 0,
    last_kata_date   DATE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE daily_kata_history (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kata_date      DATE NOT NULL,
    task_id        UUID NOT NULL REFERENCES tasks(id),
    is_cursed      BOOLEAN NOT NULL DEFAULT FALSE,
    is_weekly_boss BOOLEAN NOT NULL DEFAULT FALSE,
    passed         BOOLEAN,
    freeze_used    BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at   TIMESTAMPTZ,
    PRIMARY KEY (user_id, kata_date)
);

CREATE TABLE interview_calendars (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id),
    role            TEXT NOT NULL,
    interview_date  DATE NOT NULL,
    current_level   TEXT,
    plan_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
    readiness_pct   INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Non-unique: the daily domain's app layer picks the currently-active
-- calendar by filtering on interview_date at query time. A predicate of
-- `WHERE interview_date >= CURRENT_DATE` cannot be a unique-index predicate
-- in Postgres (functions in index predicate must be IMMUTABLE).
CREATE INDEX idx_interview_calendars_user_date ON interview_calendars(user_id, interview_date DESC);

CREATE TABLE interview_autopsies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id),
    section         TEXT NOT NULL,
    outcome         TEXT NOT NULL,
    interview_date  DATE,
    questions_raw   TEXT,
    answers_raw     TEXT,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'processing',
    analysis_json   JSONB,
    share_slug      TEXT UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT autopsies_outcome_valid CHECK (outcome IN ('offer','rejection','pending')),
    CONSTRAINT autopsies_status_valid CHECK (status IN ('processing','ready','failed'))
);

CREATE TABLE podcasts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_ru      TEXT NOT NULL,
    title_en      TEXT NOT NULL,
    description   TEXT,
    section       TEXT NOT NULL,
    duration_sec  INT NOT NULL,
    audio_key     TEXT NOT NULL,
    is_published  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE podcast_progress (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    podcast_id    UUID NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    listened_sec  INT NOT NULL DEFAULT 0,
    completed_at  TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, podcast_id)
);

CREATE INDEX idx_kata_history_user_date ON daily_kata_history(user_id, kata_date DESC);
CREATE INDEX idx_autopsies_user ON interview_autopsies(user_id, created_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS podcast_progress;
DROP TABLE IF EXISTS podcasts;
DROP TABLE IF EXISTS interview_autopsies;
DROP TABLE IF EXISTS interview_calendars;
DROP TABLE IF EXISTS daily_kata_history;
DROP TABLE IF EXISTS daily_streaks;
-- +goose StatementEnd
