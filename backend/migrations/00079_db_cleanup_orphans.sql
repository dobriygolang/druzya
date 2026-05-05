-- 00079_db_cleanup_orphans.sql — R9 deep cleanup phase 1.
--
-- Drops orphan columns (write-only or never-touched) inside live tables,
-- and prunes the dynamic_config seed rows that lost their consumers when
-- arena / RPG / kata layers были выпилены ранее.
--
-- Cleanups (verified by grep over backend/services + backend/cmd, ignoring
-- generated SQLC models and test fixtures):
--
--   1. coach_episodes.embedding (REAL[]) — оставался от Phase IX dual-write
--      (legacy real[] + pgvector). После полного перехода на embedding_vec
--      (см. SearchSimilar / EmbedWorker) колонка только пишется и сканится
--      назад, но никогда не используется в поиске. Дропаем — embedding_vec
--      покрывает все RAG-запросы.
--
--   2. hone_user_settings.onboarding_version — добавлена в 00061 под
--      Phase 6 wizard, но reader/writer так и не материализовались.
--      Default 0 на каждую строку, никем не читается.
--
--   3. dynamic_config seed rows — 21 ключ из baseline 00001 которые
--      ссылались на arena / RPG / kata / voice mode / hardcoded LLM
--      defaults. Все эти кодпути удалены. Оставляем только активные
--      (copilot_plans, llm.*, coach.*).
--
-- Code-side cleanup для coach_episodes.embedding уже сделан в R11
-- (commit 24fcfa9): Episode.Embedding поле убрано, INSERT/SCAN/UPDATE
-- не упоминают колонку, MarkStaleForReembed теперь фильтрует по
-- embedding_vec IS NOT NULL. Эта миграция приводит схему в соответствие.
--
-- См. CLAUDE.md (R9 in progress), memory/project_state.md.

-- +goose Up
-- +goose StatementBegin

-- ── 1. coach_episodes.embedding (legacy REAL[]) ─────────────────────────
ALTER TABLE coach_episodes DROP COLUMN IF EXISTS embedding;

-- ── 2. hone_user_settings.onboarding_version ───────────────────────────
ALTER TABLE hone_user_settings DROP COLUMN IF EXISTS onboarding_version;

-- ── 3. dynamic_config: prune orphan seed rows from baseline 00001 ──────
-- Все ключи ниже не имеют consumer'ов в backend/services / backend/cmd.
DELETE FROM dynamic_config WHERE key IN (
    'arena_workers_count',
    'arena_anticheat_threshold',
    'arena_match_confirm_sec',
    'ai_max_concurrent_sessions',
    'ai_stress_pause_threshold_ms',
    'elo_k_factor_new',
    'elo_k_factor_veteran',
    'xp_arena_win',
    'xp_arena_loss',
    'xp_mock_complete',
    'xp_kata_daily',
    'xp_kata_cursed_multiplier',
    'xp_task_algo',
    'xp_task_sysdesign',
    'xp_task_quiz',
    'xp_task_custom',
    'skill_decay_days',
    'skill_decay_rate_pct',
    'voice_mode_enabled',
    'llm_default_free_model',
    'llm_default_paid_model'
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- IRRECOVERABLE: dropping columns destroys data, and reseeding old
-- dynamic_config rows resurrects orphan keys with no consumer. Down is
-- intentionally a no-op — rollback is "restore from backup".
SELECT 1;
-- +goose StatementEnd
