-- 00110_restore_ml_active_track.sql — M1 (P0): identity bug fix
-- 2026-05-12: identity.md обещает «3 equal tracks: Go senior · ML
-- engineering · English». Реальность после mig 00046 (Phase 4.1 drop ML):
-- ActiveTrack enum юзеру в Hone — `general / dev / english / go`, ML
-- невидим. Восстанавливаем 'ml' как first-class active track.
--
-- Scope: только hone_user_settings.active_track CHECK constraint. Не
-- трогаем track_kind ENUM (он остаётся 6 значений; ML атлас-узлы
-- по-прежнему tag'нуты как dev_senior — это валидно, ml-coach persona
-- scoped to 'dev_senior'). Юзер просто получает отдельный study-mode
-- 'ml' для UI-фильтра + правильный persona handoff в Hone Reading /
-- TodayPage / AtlasDrawer.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE hone_user_settings
    DROP CONSTRAINT IF EXISTS hone_user_settings_active_track_check;

ALTER TABLE hone_user_settings
    ADD CONSTRAINT hone_user_settings_active_track_check
        CHECK (active_track IN ('general','dev','ml','english','go'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- На rollback'е любые юзера с active_track='ml' валидно мигрируем в 'dev'
-- (точно как делал mig 00046).
UPDATE hone_user_settings SET active_track = 'dev'
 WHERE active_track = 'ml';

ALTER TABLE hone_user_settings
    DROP CONSTRAINT IF EXISTS hone_user_settings_active_track_check;

ALTER TABLE hone_user_settings
    ADD CONSTRAINT hone_user_settings_active_track_check
        CHECK (active_track IN ('general','dev','english','go'));
-- +goose StatementEnd
