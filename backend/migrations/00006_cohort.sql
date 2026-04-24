-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00006 cohorts (когорты — бывшие guilds, переименованы feature-rename'ом)
-- Консолидированы: 00005_guild_slots (cohort-часть),
--   00018_guild_public (public/join_policy),
--   00023_guild_disband_cascade (SET NULL winner).
-- Старая cohort-фича (00030/00051/00054) снесена полностью —
-- дублировала guild как «long-lived membership group с лидербордом».
-- ============================================================

-- Основная таблица: группа с общим рейтингом, pvp-войнами и секциями.
CREATE TABLE cohorts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name         TEXT NOT NULL UNIQUE,
    emblem       TEXT,
    cohort_elo   INT NOT NULL DEFAULT 1000,
    description  TEXT,
    tier         TEXT,
    is_public    BOOLEAN NOT NULL DEFAULT TRUE,
    join_policy  TEXT NOT NULL DEFAULT 'open',
    max_members  INT  NOT NULL DEFAULT 25,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cohorts_join_policy_valid CHECK (join_policy IN ('open', 'invite', 'closed')),
    CONSTRAINT cohorts_tier_valid
        CHECK (tier IS NULL OR tier IN ('bronze','silver','gold','platinum','diamond','master'))
);
-- Частичный индекс: каталог /cohorts листает только public-строки
-- отсортированные по рейтингу.
CREATE INDEX idx_cohorts_is_public_elo
    ON cohorts(is_public, cohort_elo DESC) WHERE is_public = TRUE;

CREATE TABLE cohort_members (
    cohort_id         UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role              TEXT NOT NULL DEFAULT 'member',
    assigned_section  TEXT,
    joined_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cohort_id, user_id),
    CONSTRAINT cohort_members_role_valid    CHECK (role IN ('captain','member')),
    CONSTRAINT cohort_members_section_valid CHECK (assigned_section IS NULL OR assigned_section IN ('algorithms','sql','go','system_design','behavioral'))
);
-- Одна cohort на юзера — unique индекс на user_id.
CREATE UNIQUE INDEX idx_cohort_members_one_cohort ON cohort_members(user_id);

CREATE TABLE cohort_wars (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_a_id  UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    cohort_b_id  UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    week_start   DATE NOT NULL,
    week_end     DATE NOT NULL,
    scores_a     JSONB NOT NULL DEFAULT '{}'::jsonb,
    scores_b     JSONB NOT NULL DEFAULT '{}'::jsonb,
    winner_id    UUID REFERENCES cohorts(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cohort_wars_different CHECK (cohort_a_id <> cohort_b_id)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;
-- +goose StatementEnd
