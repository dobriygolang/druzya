-- 00087_cue_sessions.sql — F10 Cue session ingestion backend.
--
-- Cue (stealth tray-copilot) end-of-session отправляет transcript + per-stage
-- log в web Coach memory чтобы AI знал «вчера на Google interview struggled
-- with sharding». Frontend MVP — localStorage (frontend/src/lib/cueSessions.ts);
-- эта миграция ship'ит durable store. Frontend wire-shape:
--   {company, persona, stages: [{stage, self_rating}], ai_summary, raw_transcript, completed_at}
--
-- Существует concept'ивно близкий EpisodeCueConversationMemory (coach_episodes)
-- для granular per-turn copilot memory. Эта таблица — coarser unit-of-work
-- (whole session) + paginated list view для web /coach surface.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE cue_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company         TEXT,
    persona         TEXT,
    stages          JSONB NOT NULL DEFAULT '[]'::jsonb,
    ai_summary      TEXT,
    raw_transcript  TEXT,
    completed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cue_sessions_user_recent
    ON cue_sessions(user_id, completed_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS cue_sessions;

-- +goose StatementEnd
