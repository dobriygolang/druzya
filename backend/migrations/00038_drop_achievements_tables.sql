-- Phase-4 ADR-001 — drop achievements feature tables.
--
-- The gamification feature (badge catalogue, per-user unlocks, XP rain /
-- confetti UI surface) was cut from the product: AchievementsPage,
-- AchievementsCard, AchievementsPanel, AchievementToast, ConfettiBurst,
-- XPRain and lib/queries/achievements.ts have all been removed from the
-- frontend; backend/services/achievements/ and its monolith wiring
-- (cmd/monolith/services/achievements.go, the bootstrap.go registration)
-- have been removed in this same change.
--
-- This is forward-only — historical migration 00002_progression.sql stays
-- byte-stable. Drop order respects FKs (user_achievements has no FK to
-- achievements.code in the current schema, but we drop the dependent table
-- first as a defensive default and to mirror the convention used in
-- 00037_drop_orphan_tables.sql). Indexes owned by the dropped tables
-- (idx_user_ach_user) go away with their parent table.

-- +goose Up
DROP TABLE IF EXISTS user_achievements;
DROP TABLE IF EXISTS achievements;

-- +goose Down
-- Forward-only — restoring requires re-running 00002_progression.sql plus
-- restoring the matching service code (backend/services/achievements/).
-- Down is intentionally a no-op so a partial rollback doesn't leave the
-- schema half-restored without the matching service code.
SELECT 1;
