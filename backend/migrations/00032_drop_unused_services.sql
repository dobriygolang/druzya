-- +goose Up
-- +goose StatementBegin

-- 00032_drop_unused_services.sql
--
-- Pivot 2026-05-01 (см docs/feature/identity.md). Дропаем три сервиса
-- которые либо не использовались (feed — anonymous public stream без UI
-- surface; tg_coach — STRATEGIC SCAFFOLD под build-tag, return 501),
-- либо overlap'ят с другим сервисом (clubs дублирует circles):
--
--   clubs           — book/study clubs с curator + sessions; merge с
--                     circles группой events
--   tg_user_link    — Telegram OAuth-link (tg_coach)
--   tg_link_tokens  — issue tokens (tg_coach)
--
-- feed had no SQL tables — был чисто in-memory WS-broadcaster.

DROP TABLE IF EXISTS club_attendees CASCADE;
DROP TABLE IF EXISTS club_materials CASCADE;
DROP TABLE IF EXISTS club_sessions CASCADE;
DROP TABLE IF EXISTS clubs CASCADE;

DROP TABLE IF EXISTS tg_link_tokens CASCADE;
DROP TABLE IF EXISTS tg_user_link CASCADE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- one-way drop; rollback drops the DB
-- +goose StatementEnd
