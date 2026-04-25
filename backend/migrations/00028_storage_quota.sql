-- +goose Up
-- +goose StatementBegin
--
-- Phase C: storage quota — фундамент монетизации.
--
-- Free tier: 1 GiB на одно устройство (single-device, no sync).
-- Pro 790₽:  10 GiB + cross-device sync.
-- Pro+ 2490₽: 100 GiB + sync.
--
-- На этом этапе только TRACKING — никакой жёсткой блокировки.
-- Фронт показывает usage bar в Settings; превышение → soft-warning.
-- Hard-enforcement (413 Payload Too Large на write'ы) — следующий
-- инкремент после того как наберём sample-юзеров и поймём реальный
-- дистрибьюшн использования.
--
-- storage_used_bytes пересчитывается hourly cron'ом (StorageRecomputer
-- в monolith bootstrap), который суммирует:
--   - hone_notes.size_bytes
--   - hone_whiteboards (длина state_json)
--   - coach_episodes (приближённо: length(summary) + length(payload::text))
-- focus_sessions / streak_days — счётчики, объём пренебрежимый, не
-- учитываем.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS storage_quota_bytes BIGINT NOT NULL DEFAULT 1073741824, -- 1 GiB
    ADD COLUMN IF NOT EXISTS storage_used_bytes  BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS storage_tier        TEXT   NOT NULL DEFAULT 'free',
    ADD COLUMN IF NOT EXISTS storage_recomputed_at TIMESTAMPTZ;

ALTER TABLE users
    ADD CONSTRAINT users_storage_tier_valid
    CHECK (storage_tier IN ('free', 'pro', 'pro_plus'));

-- Index по tier — для analytics дашбордов («сколько pro юзеров»).
-- Partial — большинство юзеров на free, low-cardinality.
CREATE INDEX IF NOT EXISTS idx_users_storage_tier_paid
    ON users(storage_tier)
    WHERE storage_tier <> 'free';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_users_storage_tier_paid;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_storage_tier_valid;
ALTER TABLE users
    DROP COLUMN IF EXISTS storage_recomputed_at,
    DROP COLUMN IF EXISTS storage_tier,
    DROP COLUMN IF EXISTS storage_used_bytes,
    DROP COLUMN IF EXISTS storage_quota_bytes;
-- +goose StatementEnd
