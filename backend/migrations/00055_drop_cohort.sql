-- +goose Up
-- +goose StatementBegin
-- Cohort feature sunset. Cohorts overlapped with guilds (both are
-- long-lived membership groups with a leaderboard) and the UX was
-- splitting focus; owner chose to consolidate on guilds. Drop order
-- respects the FK chain: reactions → announcements → invites →
-- members → cohorts. Every DROP is IF EXISTS so re-running against an
-- already-sunsetted DB is safe.
DROP TABLE IF EXISTS cohort_announcement_reactions CASCADE;
DROP TABLE IF EXISTS cohort_announcements CASCADE;
DROP TABLE IF EXISTS cohort_invites CASCADE;
DROP TABLE IF EXISTS cohort_members CASCADE;
DROP TABLE IF EXISTS cohorts CASCADE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Irreversible feature deletion — re-applying 00030 / 00051 / 00054
-- recreates the empty schema but historical membership data is lost.
-- We don't attempt a rollback body because there's no graceful inverse.
SELECT 1;
-- +goose StatementEnd
