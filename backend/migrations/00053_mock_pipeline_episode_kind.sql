-- 00053_mock_pipeline_episode_kind.sql
-- Adds 'mock_pipeline_finished' to the coach_episodes.kind CHECK so the
-- orchestrator can write an episode each time a candidate completes a
-- mock pipeline. The Daily Coach narrative reads these episodes to
-- give cross-week feedback («неделю назад провалил sysdesign,
-- сегодня — pass — это рост»).

-- +goose Up
-- +goose StatementBegin
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
    'mock_pipeline_finished'
));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM coach_episodes WHERE kind = 'mock_pipeline_finished';
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
    'focus_session_done'
));
-- +goose StatementEnd
