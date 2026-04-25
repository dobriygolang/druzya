-- 00042_editor_room_visibility.sql — visibility флаг для code-rooms.
-- Mirror'ит whiteboard_rooms.visibility (00036), та же семантика:
--   - shared (default): любой со ссылкой может join'иться, auto-add as
--     participant.
--   - private: только owner. Guests/новые юзеры получают 403.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE editor_rooms
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'shared'
        CHECK (visibility IN ('private', 'shared'));

-- Index для GC / дашбордов admin'а; не критичный для read-paths но дешёвый.
CREATE INDEX IF NOT EXISTS idx_editor_rooms_visibility
    ON editor_rooms(visibility) WHERE visibility = 'private';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_editor_rooms_visibility;
ALTER TABLE editor_rooms DROP COLUMN IF EXISTS visibility;

-- +goose StatementEnd
