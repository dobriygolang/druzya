-- 00081_drop_xp_events.sql — drop xp_events audit-log table.
--
-- Phase E2 cleanup after RPG / arena removal: xp_events was the audit log
-- written by profile.OnXPGained handler с closed-set source CHECK
-- (task / arena / kata / podcast / mock / quiz / review / custom).
-- После выпиливания arena / kata / quiz / review кодпутей таблица стала
-- write-only — никто из backend services не SELECT'ает её, ни одна
-- frontend / admin страница не показывает rows из xp_events.
--
-- Code-side cleanup landed в той же commit'е:
--   * profile.RecordXPEvent + InsertXPEvent SQLC query — удалены
--   * profile.xpEventSourceFromReason mapper — удалён вместе с call site
--     в OnXPGained handler (XPGained event теперь only ApplyXPDelta + LevelUp)
--   * profile.ProfileRepo interface + Postgres + CachedRepo + mock — без RecordXPEvent
--
-- См memory/project_state.md (Phase E2), CLAUDE.md (R-cleanup).

-- +goose Up
-- +goose StatementBegin

DROP TABLE IF EXISTS xp_events CASCADE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- IRRECOVERABLE: dropping the table destroys all audit-log rows. Down
-- intentionally a no-op; rollback is "restore from backup".
SELECT 1;
-- +goose StatementEnd
