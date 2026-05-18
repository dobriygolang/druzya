-- +goose Up
-- Add missing FK actions for orphan-row protection.

ALTER TABLE coach_episodes
    DROP CONSTRAINT IF EXISTS coach_episodes_embedding_model_id_fkey,
    ADD CONSTRAINT coach_episodes_embedding_model_id_fkey
        FOREIGN KEY (embedding_model_id) REFERENCES embedding_models(id) ON DELETE SET NULL;

ALTER TABLE hone_notes
    DROP CONSTRAINT IF EXISTS hone_notes_embedding_model_id_fkey,
    ADD CONSTRAINT hone_notes_embedding_model_id_fkey
        FOREIGN KEY (embedding_model_id) REFERENCES embedding_models(id) ON DELETE SET NULL;

ALTER TABLE editor_rooms
    DROP CONSTRAINT IF EXISTS editor_rooms_task_id_fkey,
    ADD CONSTRAINT editor_rooms_task_id_fkey
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;

ALTER TABLE mock_pipelines
    DROP CONSTRAINT IF EXISTS mock_pipelines_company_id_fkey,
    ADD CONSTRAINT mock_pipelines_company_id_fkey
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

ALTER TABLE mock_sessions
    DROP CONSTRAINT IF EXISTS mock_sessions_company_id_fkey,
    ADD CONSTRAINT mock_sessions_company_id_fkey
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

ALTER TABLE dynamic_config
    DROP CONSTRAINT IF EXISTS dynamic_config_updated_by_fkey,
    ADD CONSTRAINT dynamic_config_updated_by_fkey
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

-- Composite FK that was missing: user_resource_overrides.(step_track_id, step_index) -> track_steps.(track_id, step_index)
ALTER TABLE user_resource_overrides
    DROP CONSTRAINT IF EXISTS user_resource_overrides_step_track_step_fkey,
    ADD CONSTRAINT user_resource_overrides_step_track_step_fkey
        FOREIGN KEY (step_track_id, step_index) REFERENCES track_steps(track_id, step_index) ON DELETE CASCADE;

-- Auto-update updated_at on UPDATE for tables added in 00008.
CREATE OR REPLACE FUNCTION set_updated_at_timestamp() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER editor_participants_set_updated_at
    BEFORE UPDATE ON editor_participants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TRIGGER editor_rooms_set_updated_at
    BEFORE UPDATE ON editor_rooms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TRIGGER eval_runs_set_updated_at
    BEFORE UPDATE ON eval_runs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

-- Drop stale index on dropped table (was orphaned by 00006).
DROP INDEX IF EXISTS idx_day_shutdowns_user_date;

-- Replace over-engineered partial index with simpler form.
DROP INDEX IF EXISTS idx_users_tutor_mode;
CREATE INDEX IF NOT EXISTS idx_users_tutor_mode ON users (tutor_mode_enabled) WHERE tutor_mode_enabled;

-- +goose Down
DROP INDEX IF EXISTS idx_users_tutor_mode;
CREATE INDEX idx_users_tutor_mode ON public.users USING btree (id) WHERE (tutor_mode_enabled = true);

DROP TRIGGER IF EXISTS eval_runs_set_updated_at ON eval_runs;
DROP TRIGGER IF EXISTS editor_rooms_set_updated_at ON editor_rooms;
DROP TRIGGER IF EXISTS editor_participants_set_updated_at ON editor_participants;
DROP FUNCTION IF EXISTS set_updated_at_timestamp();
ALTER TABLE user_resource_overrides DROP CONSTRAINT IF EXISTS user_resource_overrides_step_track_step_fkey;
ALTER TABLE dynamic_config DROP CONSTRAINT IF EXISTS dynamic_config_updated_by_fkey;
ALTER TABLE mock_sessions DROP CONSTRAINT IF EXISTS mock_sessions_company_id_fkey;
ALTER TABLE mock_pipelines DROP CONSTRAINT IF EXISTS mock_pipelines_company_id_fkey;
ALTER TABLE editor_rooms DROP CONSTRAINT IF EXISTS editor_rooms_task_id_fkey;
ALTER TABLE hone_notes DROP CONSTRAINT IF EXISTS hone_notes_embedding_model_id_fkey;
ALTER TABLE coach_episodes DROP CONSTRAINT IF EXISTS coach_episodes_embedding_model_id_fkey;
