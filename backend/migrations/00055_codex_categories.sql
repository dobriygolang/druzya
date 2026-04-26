-- 00055_codex_categories.sql
-- Categories табличка — раньше захардкожены в frontend/src/content/codex.ts
-- (8 категорий с иконками + цветами). Теперь в БД, с возможностью
-- редактировать через админку. Иконки/цвета остаются на фронте по
-- ключу `slug` — это presentation-таблица соответствий.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE codex_categories (
    slug        text PRIMARY KEY,
    label       text NOT NULL,
    description text NOT NULL DEFAULT '',
    sort_order  integer NOT NULL DEFAULT 0,
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO codex_categories (slug, label, sort_order) VALUES
('system_design', 'System Design', 10),
('backend', 'Backend', 20),
('algorithms', 'Алгоритмы', 30),
('career', 'Карьера', 40),
('behavioral', 'Behavioral', 50),
('concurrency', 'Concurrency', 60),
('data', 'Data / SQL', 70),
('security', 'Security', 80)
ON CONFLICT (slug) DO NOTHING;

-- Coach memory tap: когда юзер открывает статью из Codex, мы пишем
-- episode 'codex_article_opened' с категорией. Daily Coach потом
-- может рекомендовать «ты часто читаешь System Design — попробуй
-- mock с этим этапом».
ALTER TABLE coach_episodes DROP CONSTRAINT coach_episode_kind_valid;
ALTER TABLE coach_episodes ADD CONSTRAINT coach_episode_kind_valid CHECK (kind IN (
    'brief_emitted',
    'brief_followed',
    'brief_dismissed',
    'qa_query',
    'qa_answered',
    'reflection_added',
    'standup_recorded',
    'plan_skipped',
    'plan_completed',
    'note_created',
    'focus_session_done',
    'mock_pipeline_finished',
    'codex_article_opened'
));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM coach_episodes WHERE kind = 'codex_article_opened';
ALTER TABLE coach_episodes DROP CONSTRAINT coach_episode_kind_valid;
ALTER TABLE coach_episodes ADD CONSTRAINT coach_episode_kind_valid CHECK (kind IN (
    'brief_emitted','brief_followed','brief_dismissed',
    'qa_query','qa_answered',
    'reflection_added','standup_recorded',
    'plan_skipped','plan_completed',
    'note_created','focus_session_done',
    'mock_pipeline_finished'
));
DROP TABLE IF EXISTS codex_categories;
-- +goose StatementEnd
