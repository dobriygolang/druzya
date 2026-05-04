-- 00061_onboarding_version.sql — Phase 6 (Onboarding modal v2 · 2026-05-04).
--
-- hone_user_settings.onboarding_version int — bump'ится при выходе wizard.
-- Settings → "Open onboarding again" reset'ит в 0 → следующий заход в Hone
-- покажет wizard заново. Default 0 для existing users — все увидят v2 wizard
-- один раз; после клика «Done» — set to current version (1 для v2).
--
-- Schema decision: int rather than bool (was-shown), потому что мы хотим
-- bumpить версию при последующих major-changes wizard'а (v3, v4) и тех
-- кто прошёл v1 заставлять заново — без миграции.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE hone_user_settings
    ADD COLUMN IF NOT EXISTS onboarding_version INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN hone_user_settings.onboarding_version IS 'Phase 6 onboarding wizard version completed by user. 0 = never finished; 1 = finished v2; future increments reset wizard для existing юзеров при major refresh.';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE hone_user_settings DROP COLUMN IF EXISTS onboarding_version;
-- +goose StatementEnd
