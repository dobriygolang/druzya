-- 00080_drop_personal_events.sql — Phase E1 calendar pivot finisher.
--
-- After the 2026-05-04 calendar pivot, every writer to personal_events was
-- removed (the calendar bounded context bootstrap was deleted). The table
-- has been read-only since: Intelligence.CalendarReader still queries it,
-- but with zero writers the result set is always empty. This migration
-- drops the orphan table along with its dependent personal_event_reminders_sent
-- (already cleared in 00067) and any FK references via CASCADE.
--
-- The companies table is intentionally NOT dropped — it stays for resume /
-- profile use cases that are independent of the calendar feature.
--
-- Code-side cleanup is shipped in the same commit:
--   - cross_readers.go: CalendarReader struct + NewCalendarReader removed
--   - entity.go: UpcomingInterview type removed
--   - daily_brief_*.go: every UpcomingInterviews reference removed
--   - next_action_loader.go: calendar field + interview scoring branch removed
--   - intelligence.go bootstrap: calR wiring removed
--   - eval_coach/dataset.json: upcoming_interviews fixtures stripped
--
-- See memory/project_state.md (calendar pivot 2026-05-04) and
-- backend/cmd/monolith/bootstrap/bootstrap.go (calendar context comment).

-- +goose Up
-- +goose StatementBegin

DROP TABLE IF EXISTS personal_events CASCADE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- IRRECOVERABLE: the table held active calendar entries (interview dates,
-- exam deadlines, study blocks). Recreating the schema would not restore
-- the historical rows — rollback is "restore from backup".
SELECT 1;
-- +goose StatementEnd
