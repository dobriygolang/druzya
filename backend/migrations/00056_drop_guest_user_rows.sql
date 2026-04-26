-- 00056_drop_guest_user_rows.sql
-- Wave-15: гости больше не персистятся в БД. Share-link join теперь
-- выдаёт scoped JWT с display-name claim'ом, без INSERT в users.
-- Цель миграции:
--   1. Убрать любые orphaned guest-user rows которые накопились до
--      этого изменения.
--   2. Снести `ephemeral` колонку и связанный индекс — они больше
--      нигде не читаются.
--   3. Убрать 'guest' из CHECK constraint на users.role — guest'ы
--      больше не должны существовать как rows вообще.
--
-- Каскадно удалятся participants rows (FK ON DELETE CASCADE), что
-- безопасно: WS handler перестаёт писать туда новые guest-rows этим
-- же релизом.

-- +goose Up
-- +goose StatementBegin
DELETE FROM users WHERE role = 'guest';

DROP INDEX IF EXISTS idx_users_ephemeral_role;
ALTER TABLE users DROP COLUMN IF EXISTS ephemeral;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_valid;
ALTER TABLE users ADD CONSTRAINT users_role_valid
    CHECK (role IN ('user', 'interviewer', 'admin'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_valid;
ALTER TABLE users ADD CONSTRAINT users_role_valid
    CHECK (role IN ('user', 'interviewer', 'admin', 'guest'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS ephemeral BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_users_ephemeral_role
    ON users(ephemeral, role) WHERE ephemeral = TRUE;
-- +goose StatementEnd
