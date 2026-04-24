-- +goose Up
-- +goose StatementBegin
--
-- Shared whiteboards (bible §9 Phase 6.5.4 — multiplayer Excalidraw).
-- Приватные hone_whiteboards остаются отдельным бэкендом (00015) — это
-- осознанно: приватные живут у пользователя, shared — расшаривается.
--
-- snapshot хранит Yjs-документ как merged update blob. На первом join'е
-- сервер отдаёт его новому клиенту, тот применяет Y.applyUpdate и
-- подключается к relay. Сервер периодически перезаписывает snapshot'ом
-- из in-memory hub (debounce 30s) чтобы не платить на каждом keystroke.
CREATE TABLE whiteboard_rooms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    snapshot    BYTEA,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whiteboard_rooms_owner ON whiteboard_rooms(owner_id);
CREATE INDEX idx_whiteboard_rooms_expires ON whiteboard_rooms(expires_at);

CREATE TABLE whiteboard_room_participants (
    room_id    UUID NOT NULL REFERENCES whiteboard_rooms(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, user_id)
);

CREATE INDEX idx_whiteboard_participants_user ON whiteboard_room_participants(user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS whiteboard_room_participants;
DROP TABLE IF EXISTS whiteboard_rooms;
-- +goose StatementEnd
