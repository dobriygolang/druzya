-- 00066_collab_rooms_meta.sql — Phase 9a Path C low-key standalone rooms.
--
-- См docs/feature/implementation-plan.md §9a + memory/feedback_path_c_rooms.md.
--
-- Existing tables editor_rooms / whiteboard_rooms уже имеют `expires_at` —
-- TTL уже первоклассно. Добавляем:
--
--   * archived_at  — soft-delete столбец, restorable 30d window
--   * free_tier    — boolean ярлык (true = создан под free-tier limits, не
--                    через tutor/mock/club). Используется для quota
--                    counter'а.
--   * user_room_quota — per-user counter активных rooms. Cron'ом
--                       синхронизируется с реальным count'ом.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE editor_rooms
    ADD COLUMN archived_at TIMESTAMPTZ NULL,
    ADD COLUMN free_tier   BOOLEAN     NOT NULL DEFAULT FALSE;

ALTER TABLE whiteboard_rooms
    ADD COLUMN archived_at TIMESTAMPTZ NULL,
    ADD COLUMN free_tier   BOOLEAN     NOT NULL DEFAULT FALSE;

-- Индексы для cron-scan (TTL daemon ищет expired non-archived rows)
-- + admin /admin/rooms list-by-status (active|expired|archived).
CREATE INDEX idx_editor_rooms_active
    ON editor_rooms(owner_id) WHERE archived_at IS NULL;
CREATE INDEX idx_editor_rooms_archive_candidates
    ON editor_rooms(expires_at) WHERE archived_at IS NULL;
CREATE INDEX idx_whiteboard_rooms_active
    ON whiteboard_rooms(owner_id) WHERE archived_at IS NULL;
CREATE INDEX idx_whiteboard_rooms_archive_candidates
    ON whiteboard_rooms(expires_at) WHERE archived_at IS NULL;

-- Per-user quota counter. tier ∈ free|pro (matches subscription_tiers
-- enum через text), period_start — анкер для ротации (week / month
-- зависимо от subscription model).
CREATE TABLE user_room_quota (
    user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    active_count  INT          NOT NULL DEFAULT 0,
    tier          TEXT         NOT NULL DEFAULT 'free',
    period_start  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT user_room_quota_tier_valid CHECK (tier IN ('free','pro'))
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS user_room_quota;
DROP INDEX IF EXISTS idx_whiteboard_rooms_archive_candidates;
DROP INDEX IF EXISTS idx_whiteboard_rooms_active;
DROP INDEX IF EXISTS idx_editor_rooms_archive_candidates;
DROP INDEX IF EXISTS idx_editor_rooms_active;
ALTER TABLE whiteboard_rooms DROP COLUMN IF EXISTS free_tier, DROP COLUMN IF EXISTS archived_at;
ALTER TABLE editor_rooms     DROP COLUMN IF EXISTS free_tier, DROP COLUMN IF EXISTS archived_at;
-- +goose StatementEnd
