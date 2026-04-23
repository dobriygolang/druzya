-- Queries consumed by sqlc. The hand-rolled pgx code in infra/postgres.go
-- mirrors these 1:1 — once `make gen-sqlc` runs they will replace the hand code.

-- name: FindUserByID :one
SELECT id, email, username, role, locale, display_name, avatar_url, created_at, updated_at
FROM users
WHERE id = $1;

-- name: FindUserByUsername :one
SELECT id, email, username, role, locale, display_name, avatar_url, created_at, updated_at
FROM users
WHERE username = $1;

-- name: FindOAuthLink :one
SELECT user_id
FROM oauth_accounts
WHERE provider = $1 AND provider_user_id = $2;

-- name: CreateUser :one
INSERT INTO users(email, username, role, locale, display_name, avatar_url)
VALUES (NULLIF($1::text, ''), $2, $3, $4, NULLIF($5::text, ''), $6)
RETURNING id, email, username, role, locale, display_name, avatar_url, created_at, updated_at;

-- name: CreateOAuthAccount :exec
INSERT INTO oauth_accounts(
    user_id, provider, provider_user_id,
    access_token_enc, refresh_token_enc, token_expires_at
) VALUES ($1, $2, $3, $4, $5, $6);

-- name: TouchOAuthTokens :exec
UPDATE oauth_accounts
   SET access_token_enc  = COALESCE($3, access_token_enc),
       refresh_token_enc = COALESCE($4, refresh_token_enc),
       token_expires_at  = COALESCE($5, token_expires_at)
 WHERE provider = $1 AND provider_user_id = $2;

-- name: UpdateUserAvatar :exec
-- Опportunistically обновить avatar_url пользователя при повторном логине.
-- Пустую строку игнорируем — Telegram может не прислать photo_url, и мы не
-- хотим затереть ранее сохранённый аватар.
UPDATE users
   SET avatar_url = $2,
       updated_at = now()
 WHERE id = $1
   AND $2 <> ''
   AND $2 IS DISTINCT FROM avatar_url;

-- name: UsernameExists :one
SELECT EXISTS (SELECT 1 FROM users WHERE username = $1);
