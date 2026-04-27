-- 00062_hone_cue_sessions.sql
-- Cue desktop session imports — отдельный pseudo-folder в Hone.
--
-- В отличие от hone_notes, эти строки:
--   1. Не редактируются вручную через CreateNote — только ImportCueSession (idempotent по file_path)
--   2. Не имеют folder_id (нельзя переместить в обычную папку)
--   3. Хранят raw_analysis_json — оригинальный экспорт от Cue'а, чтобы рендерить
--      Cluely-style view даже после редактирования body_md
--
-- Body_md юзер может редактировать — это «его слой» поверх raw analysis.
-- На repeat-import (тот же file_path) body_md НЕ перезаписывается, чтобы
-- сохранить юзерские правки.

-- +goose Up

CREATE TABLE IF NOT EXISTS hone_cue_sessions (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path         text        NOT NULL,
    title             text        NOT NULL DEFAULT '',
    body_md           text        NOT NULL DEFAULT '',
    raw_analysis_json jsonb       NOT NULL DEFAULT '{}'::jsonb,
    started_at        timestamptz,
    imported_at       timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_hone_cue_sessions_user_imported
    ON hone_cue_sessions(user_id, imported_at DESC);

-- +goose Down

DROP INDEX IF EXISTS idx_hone_cue_sessions_user_imported;
DROP TABLE IF EXISTS hone_cue_sessions;
