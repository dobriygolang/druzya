-- 00086_user_primary_goals.sql — F2 frontend-spec backend (single-active goal).
--
-- Frontend MVP (frontend/src/lib/goal.ts) stores ONE active high-level user
-- goal in localStorage with shape {kind, target_company, target_level,
-- target_text, target_date}. This migration ship'ит backend для замены
-- localStorage на Connect-RPC. 5-kind enum (top_tier_co|any_senior|ml_offer|
-- english_target|custom) — отдельный концепт от existing `user_goals` table
-- (job_target/skill_target/track_target — workflow-style goals с status),
-- поэтому отдельная таблица user_primary_goals + enum primary_goal_kind.
--
-- Один active goal на user'а — partial unique index на (user_id) WHERE active.
-- Деактивация — UPDATE active=false (history preserved для AI memory).

-- +goose Up
-- +goose StatementBegin

CREATE TYPE primary_goal_kind AS ENUM (
    'top_tier_co',
    'any_senior',
    'ml_offer',
    'english_target',
    'custom'
);

CREATE TABLE user_primary_goals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind            primary_goal_kind NOT NULL,
    target_company  TEXT,
    target_level    TEXT,
    target_text     TEXT,
    target_date     DATE,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_primary_goals_active_per_user
    ON user_primary_goals(user_id) WHERE active = TRUE;
CREATE INDEX user_primary_goals_user
    ON user_primary_goals(user_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS user_primary_goals;
DROP TYPE  IF EXISTS primary_goal_kind;

-- +goose StatementEnd
