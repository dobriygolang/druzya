-- 00041_guest_role.sql — guest role на users.role CHECK + ephemeral flag.
--
-- Цель: разрешить ephemeral-юзеров для shared-board / code-room flow'а
-- без регистрации. Guest юзер живёт только на время доски (ephemeral=true),
-- может быть подчищен cron'ом когда expires room с которым он связан.
--
-- Безопасность: guest token имеет короткий TTL (см. tokens.go MintGuest),
-- его scope привязан к конкретной room через клейм. Guest не имеет доступа
-- к другим частям API — только к WS/REST конкретной доски.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_valid;

ALTER TABLE users
    ADD CONSTRAINT users_role_valid
        CHECK (role IN ('user', 'interviewer', 'admin', 'guest'));

-- ephemeral=true → юзер удалится автоматически когда последняя room в
-- которой он participant — expires. Cron-GC в whiteboard_rooms scheduler.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ephemeral BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_ephemeral_role
    ON users(ephemeral, role) WHERE ephemeral = TRUE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_users_ephemeral_role;

ALTER TABLE users DROP COLUMN IF EXISTS ephemeral;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_valid;

ALTER TABLE users
    ADD CONSTRAINT users_role_valid
        CHECK (role IN ('user', 'interviewer', 'admin'));

-- +goose StatementEnd
