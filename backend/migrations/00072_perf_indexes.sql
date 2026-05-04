-- 00072_perf_indexes.sql — Phase R2: missing indexes для горячих query-paths.
--
-- Audit-driven additions:
--   1. idx_hone_focus_sessions_ended_at — partial index для FindDrift,
--      который сканит `WHERE ended_at IS NOT NULL AND ended_at >= $1`.
--      Существующий idx_hone_focus_user_started покрывает только
--      user-фильтрованные queries; cron'у reconciler'а нужен time-range scan
--      по всем пользователям.
--   2. idx_hone_streak_days_user_day_asc — duplicate of existing index
--      с ASC direction для RangeDays (`ORDER BY day ASC`). Существующий
--      DESC индекс работает через Index Scan Backward, но ASC версия
--      cache-friendly для последовательных range запросов на 7-30 дней.
--
-- Пропущенные задачи (done in baseline или контр-показания):
--   - DROP idx_coach_episodes_user_time — composite (user_id, kind, occurred_at)
--     НЕ покрывает запрос `WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT $2`
--     (LatestByKinds без kinds-фильтра, memory_postgres.go:97-105) эффективно;
--     Postgres был бы вынужден сканировать по user_id + sort. Оставляем.
--   - ON DELETE CASCADE для follow_up_questions.task_id и task_templates.task_id
--     уже CASCADE в 00001_baseline.sql (lines 369, 378).
--   - stage_default_questions.company_id — такой колонки в схеме нет
--     (table только с stage_kind fallback). Skip.

-- +goose Up
-- +goose StatementBegin

CREATE INDEX IF NOT EXISTS idx_hone_focus_sessions_ended_at
    ON hone_focus_sessions(ended_at)
    WHERE ended_at IS NOT NULL;

-- ASC direction для RangeDays (`ORDER BY day ASC`). Coexists с
-- idx_hone_streak_days_user_day (DESC) для streak-history queries.
CREATE INDEX IF NOT EXISTS idx_hone_streak_days_user_day_asc
    ON hone_streak_days(user_id, day);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_hone_streak_days_user_day_asc;
DROP INDEX IF EXISTS idx_hone_focus_sessions_ended_at;

-- +goose StatementEnd
