-- rating queries consumed by sqlc (emitted into services/rating/infra/db).

-- name: GetRatingsByUser :many
SELECT user_id, section, elo, matches_count, last_match_at, updated_at
FROM ratings
WHERE user_id = $1
ORDER BY section;

-- name: UpsertRating :exec
-- Абсолютный overwrite — оставлен для seed/admin, где нужно выставить
-- конкретный ELO вручную. НЕ вызывать из хэндлера матча (race condition —
-- параллельные read-modify-write теряют инкременты). Для матчей использовать
-- ApplyRatingDelta.
INSERT INTO ratings(user_id, section, elo, matches_count, last_match_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, section) DO UPDATE
    SET elo           = EXCLUDED.elo,
        matches_count = EXCLUDED.matches_count,
        last_match_at = EXCLUDED.last_match_at,
        updated_at    = now();

-- name: ApplyRatingDelta :one
-- Атомарный инкремент ELO и matches_count за один SQL-стейтмент.
-- Исключает race condition, при котором два параллельных матча читают
-- одинаковый oldElo и перетирают друг друга абсолютной записью.
-- При отсутствии строки — seed через ON CONFLICT (elo = 1000 + delta,
-- matches_count = 1). Стартовое значение 1000 должно совпадать с
-- domain.InitialELO и DEFAULT в migrations/00002_rating_progression.sql.
-- Возвращает новый ELO; oldElo при необходимости восстанавливается
-- как newElo - delta.
INSERT INTO ratings(user_id, section, elo, matches_count, last_match_at)
VALUES (@user_id, @section, 1000 + @elo_delta::int, 1, @last_match_at)
ON CONFLICT (user_id, section) DO UPDATE
    SET elo           = ratings.elo + @elo_delta::int,
        matches_count = ratings.matches_count + 1,
        last_match_at = EXCLUDED.last_match_at,
        updated_at    = now()
RETURNING elo;

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
