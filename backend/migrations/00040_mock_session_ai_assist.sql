-- Phase-4 ADR-001 (Wave 3) — persist whether a mock-session allows AI assist.
-- Drives Cue copilot's block-policy and (future) leaderboard fairness watermark.
-- Default FALSE = strict / "fair" mode: no Cue help while a session is live.
-- +goose Up
-- +goose StatementBegin
ALTER TABLE mock_sessions
    ADD COLUMN ai_assist BOOLEAN NOT NULL DEFAULT FALSE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE mock_sessions
    DROP COLUMN ai_assist;
-- +goose StatementEnd
