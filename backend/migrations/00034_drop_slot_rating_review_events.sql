-- +goose Up
-- +goose StatementBegin

-- 00034_drop_slot_rating_review_events.sql
--
-- Pivot 2026-05-01 (см docs/feature/identity.md). Дропаем сервисы
-- которые потеряли смысл с новой identity:
--   slot/bookings  — Human Mock Interview booking flow (нет live
--                    interviewers, supply=0)
--   review/reviews — review of mock-interview booking, tied to slot
--   rating/ratings — ELO rating system, был для arena-1v1/2v2 (arena
--                    выпилен 2026-05-01)
--   elo_snapshots_daily — daily ELO snapshots для arena (dead с arena)
--   events/event_participants/event_notification_sent — generic events
--                    bounded context, overlaps c circles + tutor_events;
--                    circles по-прежнему рулит community-events
--   task_ratings   — per-task ELO adjustment, был для arena scoring
--
-- personal_events / personal_event_reminders_sent ОСТАЁМ — это calendar
-- service, который не дропаем.

DROP TABLE IF EXISTS event_notification_sent CASCADE;
DROP TABLE IF EXISTS event_participants CASCADE;
DROP TABLE IF EXISTS events CASCADE;

DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS slots CASCADE;

DROP TABLE IF EXISTS task_ratings CASCADE;
DROP TABLE IF EXISTS elo_snapshots_daily CASCADE;
DROP TABLE IF EXISTS ratings CASCADE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- one-way drop; rollback drops the DB
-- +goose StatementEnd
