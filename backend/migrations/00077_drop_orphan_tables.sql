-- 00071_drop_orphan_tables.sql — drop legacy social-graph tables.
--
-- friendships / friend_codes были созданы в 00001_baseline под фичу
-- mentor-marketplace + friends (pairwise social graph). После pivot
-- на single-track AI-coach + TG channel circles обе таблицы остались
-- без писателей и читателей в Go-коде. Удаляем безопасно.
--
-- См memory/project_state.md, CLAUDE.md (удалены за 2026-04 / 05).

-- +goose Up
-- +goose StatementBegin

DROP TABLE IF EXISTS friendships  CASCADE;
DROP TABLE IF EXISTS friend_codes CASCADE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Восстановление невозможно без полной копии baseline-схемы и данных,
-- которых уже нет. Down оставлен no-op (rollback требует backup).
SELECT 1;

-- +goose StatementEnd
