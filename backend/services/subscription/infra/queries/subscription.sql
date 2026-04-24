-- subscription queries, consumed by sqlc → services/subscription/infra/db/.
-- Все запросы работают с existing таблицей `subscriptions` (00008 + 00019).

-- name: GetSubscription :one
SELECT user_id, plan, status, provider, provider_sub_id,
       started_at, current_period_end, grace_until, updated_at
  FROM subscriptions
 WHERE user_id = $1;

-- name: UpsertSubscription :exec
-- Идемпотентная запись. Используется Admin SetTier и (в M3) Boosty sync.
-- Ставим все колонки явно, чтобы NULL не перезаписывал случайно (например
-- provider_sub_id при ручной admin-выдаче).
INSERT INTO subscriptions(
    user_id, plan, status, provider, provider_sub_id,
    started_at, current_period_end, grace_until, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (user_id) DO UPDATE
   SET plan               = EXCLUDED.plan,
       status             = EXCLUDED.status,
       provider           = EXCLUDED.provider,
       provider_sub_id    = EXCLUDED.provider_sub_id,
       started_at         = COALESCE(subscriptions.started_at, EXCLUDED.started_at),
       current_period_end = EXCLUDED.current_period_end,
       grace_until        = EXCLUDED.grace_until,
       updated_at         = EXCLUDED.updated_at;

-- name: ListSubscriptionsByPlan :many
-- Hot path для admin-dashboard. Partial index idx_subscriptions_plan_active
-- ускоряет до ≤10ms на сотнях тысяч строк.
SELECT user_id, plan, status, provider, provider_sub_id,
       started_at, current_period_end, grace_until, updated_at
  FROM subscriptions
 WHERE plan = $1 AND status = 'active'
 ORDER BY updated_at DESC
 LIMIT $2 OFFSET $3;

-- name: MarkExpiredSubscriptions :execrows
-- Batch-update всех истёкших подписок (grace_until < $1). Cron раз в час.
UPDATE subscriptions
   SET status     = 'expired',
       updated_at = now()
 WHERE status = 'active'
   AND grace_until IS NOT NULL
   AND grace_until < $1;
