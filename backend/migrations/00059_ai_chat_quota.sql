-- 00059_ai_chat_quota.sql — Phase 1.7g learning-companion (2026-05-04).
--
-- Per-user daily quota на LLM-задачи (chat'ы с tutor-personas, AI-cursor
-- suggestions, etc). Защищает free-tier Groq/Cerebras от drain'а одним
-- юзером и держит cost predictable.
--
-- Soft limit (30) — UI showing «вы потратили 24/30 за сегодня, осталось 6».
-- Hard limit (100) — отказ от запроса, throttle сообщение.
-- Reset на новый день UTC.
--
-- Сделано отдельной таблицей, а не колонками на users — quota state может
-- expand'нуться (per-task buckets), и иметь отдельную таблицу легче
-- индексировать + truncate'ить старые дни.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE ai_chat_quota (
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quota_date  DATE         NOT NULL,
    count       INT          NOT NULL DEFAULT 0 CHECK (count >= 0),
    soft_limit  INT          NOT NULL DEFAULT 30 CHECK (soft_limit > 0),
    hard_limit  INT          NOT NULL DEFAULT 100 CHECK (hard_limit >= soft_limit),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, quota_date)
);

-- Old-day cleanup batch — DELETE WHERE quota_date < now() - 90 days
-- (cron в admin Phase 12.5h). Index не нужен на quota_date — full-table
-- DELETE дёшев на 100k rows, и UC не запрашивает по дате across users.

COMMENT ON TABLE  ai_chat_quota             IS 'Per-user daily quota usage для LLM-задач: chat / suggestions / coach. Reset через INSERT ... ON CONFLICT.';
COMMENT ON COLUMN ai_chat_quota.count       IS 'Suммарное число LLM-вызовов за день. Inc при каждом успешном TaskAssistantNextAction / TaskAITutorML / etc.';
COMMENT ON COLUMN ai_chat_quota.soft_limit  IS 'Above this — UI badge «approaching limit». Ниже hard_limit.';
COMMENT ON COLUMN ai_chat_quota.hard_limit  IS 'Above this — UC отказывает с 429-like ошибкой. Admin может поднять per-user.';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS ai_chat_quota;
-- +goose StatementEnd
