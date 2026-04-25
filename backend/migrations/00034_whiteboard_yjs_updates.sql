-- +goose Up
-- +goose StatementBegin
--
-- Phase C-6.1: whiteboard_yjs_updates — append-only Yjs CRDT log для
-- private (single-user multi-device) whiteboards.
--
-- Архитектурно идентично note_yjs_updates (см. 00033 header). Excalidraw
-- state — это массив shapes; client держит его в Y.Map<shapeId, Y.Map<…>>
-- так что добавление/правка одного shape'а = маленький delta-update
-- независимо от размера всей доски.
--
-- Public-collab whiteboards (services/whiteboard_rooms) уже используют
-- WebSocket-relay'ёный Y.Doc — там СВОИ updates через WS пайплайн, не
-- эта таблица. Эта таблица только для приватных hone_whiteboards
-- (sync между девайсами одного юзера).
CREATE TABLE whiteboard_yjs_updates (
    seq              BIGSERIAL PRIMARY KEY,
    whiteboard_id    UUID NOT NULL REFERENCES hone_whiteboards(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    update_data      BYTEA NOT NULL,
    origin_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whiteboard_yjs_updates_wb_seq
    ON whiteboard_yjs_updates(whiteboard_id, seq);
CREATE INDEX idx_whiteboard_yjs_updates_user_seq
    ON whiteboard_yjs_updates(user_id, seq);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS whiteboard_yjs_updates;
-- +goose StatementEnd
