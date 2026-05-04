-- 00046_drop_ml_track_kind.sql — Phase 4.1 «Drop ML enum, keep content».
--
-- Sergey 2026-05-04: «4.1 Drop ML enum из track_kind, keep content».
-- ML как явный hardcoded трек убран после rethink'а (см. identity.md):
-- ML — это специализация внутри dev_senior, а не отдельный персонаж.
-- 12 atlas-узлов из миграции 00033 остаются — но re-tag'нуты под
-- track_kind='dev_senior', чтобы продолжать показываться в /atlas
-- сениорам.
--
-- Postgres не позволяет ALTER TYPE … DROP VALUE напрямую — нужен
-- rebuild через rename-old/create-new/cast/drop. Атомарно через
-- одну транзакцию (см. goose StatementBegin block).
--
-- Дополнительно — hone_user_settings.active_track CHECK теряет 'ml'
-- (миграция 00035 ввела его, теперь убираем).

-- +goose Up
-- +goose StatementBegin
-- 1) Re-tag атлас-узлов: всё что было ml → dev_senior.
UPDATE atlas_nodes
   SET track_kind = 'dev_senior'
 WHERE track_kind::text = 'ml';

-- Если в user_persona_tracks были ml-rows — тоже мигрируем (defensive,
-- UPDATE на пустом сете безопасен). tutor_listings уже DROP'нут в
-- 00031_drop_marketplace.sql — пропускаем.
UPDATE user_persona_tracks
   SET track = 'dev_senior'
 WHERE track::text = 'ml';

-- 2) Rebuild ENUM без 'ml'.
ALTER TYPE track_kind RENAME TO track_kind_old;

CREATE TYPE track_kind AS ENUM (
    'dev',
    'dev_senior',
    'sysanalyst',
    'product_analyst',
    'qa',
    'english'
);

ALTER TABLE atlas_nodes
    ALTER COLUMN track_kind TYPE track_kind
    USING track_kind::text::track_kind;

ALTER TABLE user_persona_tracks
    ALTER COLUMN track TYPE track_kind
    USING track::text::track_kind;

DROP TYPE track_kind_old;

-- 3) hone_user_settings.active_track CHECK без 'ml' (mig 00035 + 00042).
UPDATE hone_user_settings SET active_track = 'dev'
 WHERE active_track = 'ml';

ALTER TABLE hone_user_settings
    DROP CONSTRAINT IF EXISTS hone_user_settings_active_track_check;

ALTER TABLE hone_user_settings
    ADD CONSTRAINT hone_user_settings_active_track_check
        CHECK (active_track IN ('general','dev','english','go'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Восстанавливаем 'ml' в enum (rebuild обратно).
ALTER TYPE track_kind RENAME TO track_kind_old;

CREATE TYPE track_kind AS ENUM (
    'dev',
    'dev_senior',
    'sysanalyst',
    'product_analyst',
    'qa',
    'english',
    'ml'
);

ALTER TABLE atlas_nodes
    ALTER COLUMN track_kind TYPE track_kind
    USING track_kind::text::track_kind;

ALTER TABLE user_persona_tracks
    ALTER COLUMN track TYPE track_kind
    USING track::text::track_kind;

DROP TYPE track_kind_old;

ALTER TABLE hone_user_settings
    DROP CONSTRAINT IF EXISTS hone_user_settings_active_track_check;

ALTER TABLE hone_user_settings
    ADD CONSTRAINT hone_user_settings_active_track_check
        CHECK (active_track IN ('general','dev','ml','english','go'));
-- +goose StatementEnd
