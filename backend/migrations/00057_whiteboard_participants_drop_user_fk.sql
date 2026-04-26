-- 00057_whiteboard_participants_drop_user_fk.sql
-- Wave-15 follow-up: после 00056 (guest rows удалены из users) auto-join
-- в /api/v1/whiteboard/room/{id} падал с FK violation
-- ("whiteboard_room_participants_user_id_fkey") — guest user_id из JWT
-- claim'а не существует в users table.
--
-- Решение: снять FK constraint на user_id. Колонка остаётся UUID NOT NULL,
-- но enforce'а на users(id) больше нет. Owner_id на whiteboard_rooms
-- остаётся с FK — это всегда настоящий user.
--
-- Альтернативой было бы skip'ать auto-join для guest'ов в коде; но это
-- ломает participants-list (guest'ы не показывались бы как online). Drop
-- FK даёт корректный participants list БЕЗ persistence guest user'ов.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE whiteboard_room_participants
    DROP CONSTRAINT IF EXISTS whiteboard_room_participants_user_id_fkey;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE whiteboard_room_participants
    ADD CONSTRAINT whiteboard_room_participants_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
-- +goose StatementEnd
