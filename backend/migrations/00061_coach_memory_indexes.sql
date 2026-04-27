-- +goose Up
-- +goose StatementBegin
-- Hot-path indexes for AI Coach memory.
--
-- Daily brief recall reads recent embedded rows and per-kind recency tails.
-- AckRecommendation resolves a brief_emitted episode by payload.brief_id.

CREATE INDEX IF NOT EXISTS idx_coach_episodes_user_embedded_time
    ON coach_episodes(user_id, occurred_at DESC)
    WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coach_episodes_user_kind_embedded_time
    ON coach_episodes(user_id, kind, occurred_at DESC)
    WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coach_episodes_brief_emitted_brief_id
    ON coach_episodes(user_id, (payload->>'brief_id'), created_at DESC)
    WHERE kind = 'brief_emitted';

-- The original pending index is on created_at only. This partial compound
-- index keeps the worker's ORDER BY covered as the table grows.
CREATE INDEX IF NOT EXISTS idx_coach_episodes_pending_embedding_created_id
    ON coach_episodes(created_at, id)
    WHERE embedded_at IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_coach_episodes_pending_embedding_created_id;
DROP INDEX IF EXISTS idx_coach_episodes_brief_emitted_brief_id;
DROP INDEX IF EXISTS idx_coach_episodes_user_kind_embedded_time;
DROP INDEX IF EXISTS idx_coach_episodes_user_embedded_time;
-- +goose StatementEnd
