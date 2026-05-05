-- 00071_drop_daily_kata_streaks.sql — удаление daily_streaks + daily_kata_history.
--
-- DailyKata events были удалены ранее (вместе с notify/hone subscribers).
-- Никто не INSERT'ит в эти таблицы — daily_streaks статична после регистрации
-- (всегда 0/0), daily_kata_history никогда не наполняется.
--
-- Connected backend code удалён:
--   * profile.GetStreaks + ReportView.StreakDays/BestStreak/FeaturedMetric
--   * intelligence.KataReader + KataAttempt + KataStreak (DailyBrief / CoachStats)
--   * notify.StreakReader + /streak bot command
--   * admin dashboard KatasToday/Week counters

-- +goose Up
-- +goose StatementBegin

DROP TABLE IF EXISTS daily_streaks CASCADE;
DROP TABLE IF EXISTS daily_kata_history CASCADE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- one-way drop
-- +goose StatementEnd
