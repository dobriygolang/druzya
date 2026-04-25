-- +goose Up
-- +goose StatementBegin
--
-- coach_episodes — единое хранилище памяти AI-coach слоя
-- (intelligence/, bible §17 LLM-amnesia → §18 Memory layer).
--
-- Coach пишет каждое: свою выдачу (brief_emitted), реакцию юзера
-- (brief_followed/dismissed), Q&A (qa_query/answered), а также
-- side-effect события из hone (reflection_added, standup_recorded,
-- plan_skipped/completed, note_created, focus_session_done).
--
-- Embedding (bge-m3 1024-dim, real[]) — async через worker. На write
-- embedded_at = NULL; worker подбирает batch и обновляет.
-- НЕ pgvector: см. 00011_documents.sql / 00014_hone_notes.sql header
-- (один и тот же float4-array подход в трёх местах).
CREATE TABLE coach_episodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    summary         TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding       real[],
    embedding_model TEXT,
    embedded_at     TIMESTAMPTZ,
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT coach_episode_kind_valid CHECK (kind IN (
        'brief_emitted',
        'brief_followed',
        'brief_dismissed',
        'qa_query',
        'qa_answered',
        'reflection_added',
        'standup_recorded',
        'plan_skipped',
        'plan_completed',
        'note_created',
        'focus_session_done'
    ))
);

CREATE INDEX idx_coach_episodes_user_kind_time
    ON coach_episodes(user_id, kind, occurred_at DESC);

CREATE INDEX idx_coach_episodes_user_time
    ON coach_episodes(user_id, occurred_at DESC);

-- Worker queries: WHERE embedded_at IS NULL ORDER BY created_at LIMIT 64.
-- Partial index — крошечный, hot-path не цепляет полную таблицу.
CREATE INDEX idx_coach_episodes_pending_embedding
    ON coach_episodes(created_at)
    WHERE embedded_at IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS coach_episodes;
-- +goose StatementEnd
