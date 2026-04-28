-- subscription queries, consumed by sqlc → services/subscription/infra/db/.
-- v2: started_at + boosty_level dropped from subscriptions.

-- name: GetSubscription :one
SELECT user_id, plan, status, provider, provider_sub_id,
       current_period_end, grace_until, updated_at
  FROM subscriptions
 WHERE user_id = $1;

-- name: UpsertSubscription :exec
-- Idempotent write. Used by Admin SetTier and the Boosty/yookassa sync.
-- Set every column explicitly so NULLs don't accidentally overwrite (e.g.
-- provider_sub_id during manual admin grants).
INSERT INTO subscriptions(
    user_id, plan, status, provider, provider_sub_id,
    current_period_end, grace_until, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (user_id) DO UPDATE
   SET plan               = EXCLUDED.plan,
       status             = EXCLUDED.status,
       provider           = EXCLUDED.provider,
       provider_sub_id    = EXCLUDED.provider_sub_id,
       current_period_end = EXCLUDED.current_period_end,
       grace_until        = EXCLUDED.grace_until,
       updated_at         = EXCLUDED.updated_at;

-- name: ListSubscriptionsByPlan :many
-- Hot path for admin dashboard. The partial index
-- idx_subscriptions_plan_active keeps this <10ms over hundreds of thousands.
SELECT user_id, plan, status, provider, provider_sub_id,
       current_period_end, grace_until, updated_at
  FROM subscriptions
 WHERE plan = $1 AND status = 'active'
 ORDER BY updated_at DESC
 LIMIT $2 OFFSET $3;

-- name: MarkExpiredSubscriptions :execrows
-- Batch-update lapsed subscriptions (grace_until < $1). Hourly cron.
UPDATE subscriptions
   SET status     = 'expired',
       updated_at = now()
 WHERE status = 'active'
   AND grace_until IS NOT NULL
   AND grace_until < $1;
