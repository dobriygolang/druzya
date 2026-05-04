-- 00068_drop_anticheat_attribute_columns.sql — продолжение cleanup'а.
--
-- 1) anticheat_signals — таблица была live (подсчёт за 24h на admin
--    dashboard), но никто не INSERT'ил после удаления arena. Repo-чтение
--    выпилено вместе с AnticheatRepo / AnticheatSignal types.
-- 2) profiles.intellect/strength/dexterity/will/title/avatar_frame —
--    legacy RPG-attributes columns. Только SELECT'ились (через
--    DeriveAttributes), писать перестали ещё до этого pivot'а.
--    DeriveAttributes / Attributes type / GlobalPowerScore удалены.

-- +goose Up
-- +goose StatementBegin

DROP TABLE IF EXISTS anticheat_signals CASCADE;

ALTER TABLE profiles
    DROP COLUMN IF EXISTS intellect,
    DROP COLUMN IF EXISTS strength,
    DROP COLUMN IF EXISTS dexterity,
    DROP COLUMN IF EXISTS will,
    DROP COLUMN IF EXISTS title,
    DROP COLUMN IF EXISTS avatar_frame;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- one-way drop; rollback drops the schema additions
-- +goose StatementEnd
