-- provider_links queries — линкерная таблица user_id ↔ external provider
-- account. Отдельный файл чтобы sqlc-package subscription не разрастался.

-- name: UpsertProviderLink :exec
-- Идемпотентная запись линка. external_tier и verified_at обновляются на
-- каждом sync (new data = more recent truth); created_at сохраняется.
INSERT INTO provider_links (user_id, provider, external_id, external_tier, verified_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, provider) DO UPDATE
   SET external_id   = EXCLUDED.external_id,
       external_tier = EXCLUDED.external_tier,
       verified_at   = EXCLUDED.verified_at,
       updated_at    = now();

-- name: GetProviderLink :one
SELECT user_id, provider, external_id, external_tier, verified_at,
       created_at, updated_at
  FROM provider_links
 WHERE user_id = $1 AND provider = $2;

-- name: FindUserByExternalID :one
-- Reverse lookup для sync'а: Boosty response → ищем нашего user_id по
-- (provider='boosty', external_id=username).
SELECT user_id
  FROM provider_links
 WHERE provider = $1 AND external_id = $2;

-- name: ListLinksByProvider :many
-- Админский dashboard + ручная sync-операция. Итерация постраничная.
SELECT user_id, provider, external_id, external_tier, verified_at,
       created_at, updated_at
  FROM provider_links
 WHERE provider = $1
 ORDER BY updated_at DESC
 LIMIT $2 OFFSET $3;
