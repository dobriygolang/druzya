-- rating queries consumed by sqlc (emitted into services/rating/infra/db).

-- name: GetRatingsByUser :many
SELECT user_id, section, elo, matches_count, last_match_at, updated_at
FROM ratings
WHERE user_id = $1
ORDER BY section;

-- name: UpsertRating :exec
INSERT INTO ratings(user_id, section, elo, matches_count, last_match_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, section) DO UPDATE
    SET elo           = EXCLUDED.elo,
        matches_count = EXCLUDED.matches_count,
        last_match_at = EXCLUDED.last_match_at,
        updated_at    = now();

-- name: TopLeaderboard :many
SELECT r.user_id,
       u.username,
       COALESCE(p.title, '') AS title,
       r.elo,
       (ROW_NUMBER() OVER (ORDER BY r.elo DESC))::int AS rank
FROM ratings r
JOIN users u     ON u.id = r.user_id
LEFT JOIN profiles p ON p.user_id = r.user_id
WHERE r.section = $1
ORDER BY r.elo DESC
LIMIT $2;

-- name: FindRank :one
-- Use a CTE that ranks every row within a section, then filter to the user.
WITH ranked AS (
    SELECT user_id,
           (ROW_NUMBER() OVER (ORDER BY elo DESC))::int AS rank
      FROM ratings
     WHERE section = $2
)
SELECT rank
  FROM ranked
 WHERE user_id = $1;

-- name: CountSection :one
-- Total rated users in a section. Used to derive percentile rank.
SELECT COUNT(*)::int AS total
  FROM ratings
 WHERE section = $1;
