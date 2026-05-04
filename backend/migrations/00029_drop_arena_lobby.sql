-- +goose Up
-- +goose StatementBegin

-- 00029_drop_arena_lobby.sql
--
-- Pivot 2026-05-01 (см docs/feature/pivot-arena-drop.md): убираем arena
-- (1v1/2v2/match/ELO matchmaker) и lobby сервисы. В прод не выкачено,
-- нагрузки нет — drop без deprecation-окна.
--
-- Что НЕ дропаем здесь:
--   * `tasks`, `task_templates`, `test_cases` — оставляем для daily/kata
--     (минимальный seed в 00026 + UI для streak в Hone), переключение на
--     `mock_tasks` отдельным коммитом если нужно.
--   * `daily_kata_history`, `daily_streaks` — daily streak features
--     остаются, retention-фича не связана с arena.
--   * `track_steps.required_kind` ENUM значения 'kata'/'arena' — менять
--     отдельно, ALTER TYPE не любит DROP VALUE.

DROP TABLE IF EXISTS arena_participants CASCADE;
DROP TABLE IF EXISTS arena_matches CASCADE;
DROP TABLE IF EXISTS lobby_members CASCADE;
DROP TABLE IF EXISTS lobbies CASCADE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- drop is one-way; no rollback (data is in arena_xp_events
           -- which we do NOT drop here so analytics-only readers survive).
-- +goose StatementEnd
