-- 00067_drop_dead_schema.sql — cleanup мёртвых таблиц/полей.
--
-- Зеро-usage таблицы (создавались под фичи которые не вышли в prod
-- или были заменены другими структурами). Удаляются вместе с зависимостями.
-- Подробности — см. отчёт о мёртвом коде в issue/PR description.

-- +goose Up
-- +goose StatementBegin

-- ── Зеро-usage tables ───────────────────────────────────────────────────
DROP TABLE IF EXISTS admin_audit_log              CASCADE;  -- 00063, никто не пишет/читает
DROP TABLE IF EXISTS ai_chat_quota                CASCADE;  -- 00059, не подключилась к flow
DROP TABLE IF EXISTS personal_event_reminders_sent CASCADE; -- calendar reminders pipeline удалён
DROP TABLE IF EXISTS tutor_brief_share_links      CASCADE;  -- 00062, RPC handler не написали
DROP TABLE IF EXISTS mentor_sessions              CASCADE;  -- 00001, mentor-marketplace выпилен
DROP TABLE IF EXISTS llm_configs                  CASCADE;  -- заменена на llm_runtime_config (singleton)
DROP TABLE IF EXISTS onboarding_progress          CASCADE;  -- заменена hone_user_settings.onboarding_version
DROP TABLE IF EXISTS session_documents            CASCADE;  -- заменена copilot_sessions.document_ids[]

-- ── Mentor-marketplace residue в profiles ───────────────────────────────
ALTER TABLE profiles
    DROP COLUMN IF EXISTS is_mentor,
    DROP COLUMN IF EXISTS mentor_hourly_rate,
    DROP COLUMN IF EXISTS mentor_bio,
    DROP COLUMN IF EXISTS mentor_languages,
    DROP COLUMN IF EXISTS mentor_verified;

-- ── circles.slug — UNIQUE NOT NULL колонка которая никогда не читается ──
ALTER TABLE circles DROP COLUMN IF EXISTS slug;

-- ── mock_pipelines residual поля ────────────────────────────────────────
ALTER TABLE mock_pipelines
    DROP COLUMN IF EXISTS role_label,
    DROP COLUMN IF EXISTS section,
    DROP COLUMN IF EXISTS updated_at;

-- ── podcast_progress.completed дублирует completed_at IS NOT NULL ───────
ALTER TABLE podcast_progress DROP COLUMN IF EXISTS completed;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- one-way drop; rollback drops the schema additions
-- +goose StatementEnd
