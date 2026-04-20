-- season queries consumed by sqlc (emitted into services/season/infra/db).

-- name: GetCurrentSeason :one
SELECT id, name, slug, theme, starts_at, ends_at, is_current
FROM seasons
WHERE is_current = TRUE
LIMIT 1;

-- name: GetSeasonProgress :one
SELECT user_id, season_id, points, tier, is_premium, updated_at
FROM season_progress
WHERE user_id = $1 AND season_id = $2;

-- name: UpsertSeasonProgress :exec
INSERT INTO season_progress(user_id, season_id, points, tier, is_premium)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, season_id) DO UPDATE
    SET points     = EXCLUDED.points,
        tier       = EXCLUDED.tier,
        is_premium = EXCLUDED.is_premium,
        updated_at = now();

-- name: IncrementSeasonPoints :one
-- Atomic SP bump. Creates the row at (points=delta, tier=0) when missing.
-- Returns the resulting points total so the caller can recompute the tier.
INSERT INTO season_progress(user_id, season_id, points, tier, is_premium)
VALUES ($1, $2, $3, 0, FALSE)
ON CONFLICT (user_id, season_id) DO UPDATE
    SET points     = season_progress.points + EXCLUDED.points,
        updated_at = now()
RETURNING points;

-- name: UpdateSeasonTier :exec
UPDATE season_progress
SET tier       = $3,
    updated_at = now()
WHERE user_id = $1 AND season_id = $2;
