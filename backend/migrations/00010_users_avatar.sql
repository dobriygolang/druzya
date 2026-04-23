-- +goose Up
-- +goose StatementBegin
-- Stores OAuth-provided avatars. Yandex builds the URL from default_avatar_id,
-- Telegram passes photo_url directly in /start payload (or Login Widget).
-- TEXT NOT NULL DEFAULT '' keeps consumers (profile DTO, match-history, leaderboard)
-- safe to read without NULL handling — empty string === "show initials".
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE users DROP COLUMN IF EXISTS avatar_url;
-- +goose StatementEnd
