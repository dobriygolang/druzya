-- +goose Up
-- vacancies — parsed dev-job postings from Russian-market sources (HH, Yandex,
-- Ozon, T-Bank, VK, etc.). Each row represents one external posting; the
-- (source, external_id) UNIQUE allows idempotent UPSERT in the hourly sync.
--
-- raw_skills: the parser's first-pass strings (often raw Russian phrases).
-- normalized_skills: lower-cased canonical tags ("go", "postgresql"…) extracted
-- by the LLM and used by the GIN index for skill-based filtering on the list.
--
-- NOTE: id is BIGSERIAL (per spec) — we treat the parsed corpus as a separate
-- catalog from auth.users (UUID); cross-domain joins happen in app-land.
CREATE TABLE IF NOT EXISTS vacancies (
    id                BIGSERIAL PRIMARY KEY,
    source            TEXT NOT NULL,
    external_id       TEXT NOT NULL,
    url               TEXT NOT NULL,
    title             TEXT NOT NULL,
    company           TEXT,
    location          TEXT,
    employment_type   TEXT,
    experience_level  TEXT,
    salary_min        INT,
    salary_max        INT,
    currency          TEXT,
    description       TEXT NOT NULL,
    raw_skills        TEXT[] NOT NULL DEFAULT '{}',
    normalized_skills TEXT[] NOT NULL DEFAULT '{}',
    posted_at         TIMESTAMPTZ,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_json          JSONB,
    UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_vacancies_skills
    ON vacancies USING GIN (normalized_skills);

CREATE INDEX IF NOT EXISTS idx_vacancies_source_posted
    ON vacancies (source, posted_at DESC);

-- saved_vacancies — per-user kanban state (saved → applied → interviewing →
-- rejected/offer). user_id is UUID and references auth.users so deleting a
-- user cascades cleanup.
CREATE TABLE IF NOT EXISTS saved_vacancies (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vacancy_id  BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'saved'
                  CHECK (status IN ('saved','applied','interviewing','rejected','offer')),
    notes       TEXT,
    saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, vacancy_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_vacancies_user
    ON saved_vacancies (user_id, status);

-- +goose Down
DROP INDEX IF EXISTS idx_saved_vacancies_user;
DROP TABLE IF EXISTS saved_vacancies;
DROP INDEX IF EXISTS idx_vacancies_source_posted;
DROP INDEX IF EXISTS idx_vacancies_skills;
DROP TABLE IF EXISTS vacancies;
