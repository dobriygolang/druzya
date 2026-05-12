-- 00094_user_milestones.sql — F2 LLM-driven milestones cache + F1 memory soft-delete.
--
-- user_milestones — кеш 10-12 weekly milestones, сгенерированных LLM cascade'ом
-- из active primary goal. Recompute раз в 30 дней; clients hit cache hot-path,
-- regeneration через POST /api/v1/intelligence/milestones/generate.
--
-- coach_episodes.deleted_at — soft-delete для F1 memory transparency. UI
-- может скрыть episode из «AI memory» панели без потери history; recall /
-- daily_brief / stats фильтруют по deleted_at IS NULL.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE user_milestones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id         UUID NOT NULL REFERENCES user_primary_goals(id) ON DELETE CASCADE,
    week_index      INT NOT NULL,
    week_start      DATE NOT NULL,
    title           TEXT NOT NULL,
    detail          TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'practice',
    done_at         TIMESTAMPTZ,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT user_milestones_category_valid
        CHECK (category IN ('foundation', 'practice', 'mock', 'reflection', 'final'))
);

CREATE UNIQUE INDEX user_milestones_unique
    ON user_milestones(user_id, goal_id, week_index);
CREATE INDEX user_milestones_recent
    ON user_milestones(user_id, generated_at DESC);

-- F1 Memory expansion Phase 2 — soft delete column for coach_episodes so the
-- AI can stop reading entries the user pruned without losing audit trail.
ALTER TABLE coach_episodes
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_coach_episodes_user_alive
    ON coach_episodes(user_id, occurred_at DESC)
    WHERE deleted_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_coach_episodes_user_alive;
ALTER TABLE coach_episodes DROP COLUMN IF EXISTS deleted_at;

DROP TABLE IF EXISTS user_milestones;

-- +goose StatementEnd
