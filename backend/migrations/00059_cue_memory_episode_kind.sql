-- +goose Up
-- +goose StatementBegin
-- Cue desktop syncs compact derived memory into the existing Coach memory
-- store. Drop the short-lived experimental table if it exists locally.
DROP TABLE IF EXISTS copilot_conversation_memory;

ALTER TABLE coach_episodes DROP CONSTRAINT coach_episode_kind_valid;
ALTER TABLE coach_episodes ADD CONSTRAINT coach_episode_kind_valid CHECK (kind IN (
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
    'focus_session_done',
    'mock_pipeline_finished',
    'codex_article_opened',
    'cue_conversation_memory'
));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM coach_episodes WHERE kind = 'cue_conversation_memory';
ALTER TABLE coach_episodes DROP CONSTRAINT coach_episode_kind_valid;
ALTER TABLE coach_episodes ADD CONSTRAINT coach_episode_kind_valid CHECK (kind IN (
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
    'focus_session_done',
    'mock_pipeline_finished',
    'codex_article_opened'
));
-- +goose StatementEnd
