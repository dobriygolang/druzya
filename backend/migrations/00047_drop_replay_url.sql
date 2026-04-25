-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00047  Drop ai_mock replay_url + ai-mock-replays bucket
-- ============================================================
-- ai_mock replay (transcript dump in MinIO) was a stub never wired to a
-- backend endpoint — frontend MockReplayPage hit a non-existent route.
-- Removed entirely (UI + uploader + bucket). The DB column survived as
-- dead weight on every mock_sessions row; drop it here so writes get a
-- smaller row footprint going forward.
--
-- Operator follow-up: `mc rb --force minio/ai-mock-replays` to free disk.

ALTER TABLE mock_sessions DROP COLUMN IF EXISTS replay_url;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE mock_sessions ADD COLUMN replay_url TEXT;
-- +goose StatementEnd
