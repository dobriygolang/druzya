-- Queries consumed by sqlc. The hand-rolled pgx code in infra/postgres.go
-- mirrors these 1:1 — once `make gen-sqlc` runs they will replace the hand code.
--
-- v2: email column dropped from `users`. Auth is OAuth-only (Yandex + Telegram);
-- no recovery, no email-based login. provider_user_id on oauth_accounts is the
-- only external identity surface.

-- name: FindUserByID :one
SELECT id, username, role, locale, display_name, avatar_url, created_at, updated_at
FROM users
WHERE id = $1;

-- name: FindUserByUsername :one
SELECT id, username, role, locale, display_name, avatar_url, created_at, updated_at
FROM users
WHERE username = $1;

-- name: FindOAuthLink :one
SELECT user_id
FROM oauth_accounts
WHERE provider = $1 AND provider_user_id = $2;

-- name: CreateUser :one
INSERT INTO users(username, role, locale, display_name, avatar_url)
VALUES ($1, $2, $3, NULLIF($4::text, ''), $5)
RETURNING id, username, role, locale, display_name, avatar_url, created_at, updated_at;

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
-- Opportunistic: refresh avatar_url on re-login. Empty string is ignored —
-- Telegram may omit photo_url and we don't want to overwrite a previously
-- saved avatar.
UPDATE users
   SET avatar_url = $2,
       updated_at = now()
 WHERE id = $1
   AND $2 <> ''
   AND $2 IS DISTINCT FROM avatar_url;

-- name: UsernameExists :one
SELECT EXISTS (SELECT 1 FROM users WHERE username = $1);
