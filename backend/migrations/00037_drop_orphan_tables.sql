-- Phase-4 ADR-001 — drop tables for features removed from the product:
--
--   * autopsy           — InterviewAutopsyPage (post-mortem flow), no UI
--                         entry, deleted in frontend Phase 4 cleanup.
--   * interview_calendar — InterviewCalendarPage, no nav surface, deleted.
--   * native_round      — NativeRoundPage (legacy mock-round), deleted.
--                         Backend service `ai_native` deleted with it.
--   * season            — SeasonPage (incomplete season pass), deleted.
--                         Backend service `season` deleted with it.
--
-- This is forward-only — historical migrations 00002 / 00005 / 00010
-- stay byte-stable. Drop order respects FK chains (provenance → sessions,
-- season_progress → seasons, season_reward_claims → season_progress).
--
-- The matching ai_native and season services have been removed from
-- backend/services/, the autopsy/calendar code has been pulled out of
-- services/daily/, and bootstrap.go no longer registers them.
-- All table reads/writes are gone.

-- +goose Up
DROP TABLE IF EXISTS native_provenance;
DROP TABLE IF EXISTS native_sessions;

DROP TABLE IF EXISTS season_reward_claims;
DROP TABLE IF EXISTS season_progress;
DROP TABLE IF EXISTS seasons;

DROP TABLE IF EXISTS interview_autopsies;
DROP TABLE IF EXISTS interview_calendars;

-- +goose Down
-- Forward-only — restoring requires re-running the original migrations
-- (00002 progression, 00005 daily mock, 00010 season rewards). Down is
-- intentionally a no-op so that a partial rollback doesn't leave the
-- schema half-restored without the matching service code.
SELECT 1;
