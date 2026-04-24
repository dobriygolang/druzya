-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00009 hot-path индексы (следует за консолидированными 00001-00008).
-- Добавлены после perf-аудита ТОП-5 hot-сервисов: каждый CREATE INDEX
-- мотивирован реальным hot-запросом. Partial-индексы предпочтены там,
-- где фильтр узкий (status IN, boolean = TRUE) — экономит disk + planner.
--
-- Каждое выражение с IF NOT EXISTS — безопасно прогонять повторно.
-- ============================================================

-- ── arena ────────────────────────────────────────────────────────────────
-- Hot: ListMyMatches / CountMyMatches — ORDER BY finished_at DESC
-- с status IN ('finished','cancelled'). Существующий индекс на status
-- покрывал только lookup; добавив finished_at trailing-ключом убираем
-- sort-фазу (index range scan отдаёт строки в нужном порядке).
CREATE INDEX IF NOT EXISTS idx_arena_matches_status_finished
    ON arena_matches(status, finished_at DESC)
    WHERE status IN ('finished', 'cancelled');

-- Hot: profile.CountWeeklyActivity (matches_won) — winner_id = $1 AND
-- finished_at >= $2. На winner_id индекса не было → sequential scan по
-- всему arena_matches. Partial на WHERE winner_id IS NOT NULL держит
-- размер маленьким (только finished-матчи его заполняют).
CREATE INDEX IF NOT EXISTS idx_arena_matches_winner_finished
    ON arena_matches(winner_id, finished_at DESC)
    WHERE winner_id IS NOT NULL;

-- ── profile / mock ───────────────────────────────────────────────────────
-- Hot: profile.CountWeeklyActivity (mock_minutes) — mock_sessions по
-- user_id AND finished_at >= $2. Существующий idx_mock_sessions_user
-- ключит (user_id, created_at DESC) — близко, но не попадает. Доп.
-- partial-индекс на finished_at даёт нужный порядок для weekly-cut
-- без дублирования основного.
CREATE INDEX IF NOT EXISTS idx_mock_sessions_user_finished
    ON mock_sessions(user_id, finished_at DESC)
    WHERE finished_at IS NOT NULL;

-- ── notify ───────────────────────────────────────────────────────────────
-- Hot: notify.ListWeeklyReportEnabled — WHERE weekly_report_enabled=TRUE.
-- Partial-индекс на узкое enabled-множество дешевле полного.
CREATE INDEX IF NOT EXISTS idx_notification_prefs_weekly_enabled
    ON notification_preferences(user_id)
    WHERE weekly_report_enabled = TRUE;

-- ── cohort / daily ───────────────────────────────────────────────────────
-- cohort.ListPublic уже покрыт idx_cohorts_is_public_elo (см. 00006) —
-- ORDER BY cohort_elo DESC матчит trailing-ключ.
-- daily hot-paths покрыты idx_kata_history_user_date / idx_autopsies_user /
-- idx_interview_calendars_user_date (см. 00005).
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_notification_prefs_weekly_enabled;
DROP INDEX IF EXISTS idx_mock_sessions_user_finished;
DROP INDEX IF EXISTS idx_arena_matches_winner_finished;
DROP INDEX IF EXISTS idx_arena_matches_status_finished;
-- +goose StatementEnd
