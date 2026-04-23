-- arena queries consumed by sqlc (emitted into services/arena/infra/db).
-- CRITICAL: solution_hint is NEVER selected into arena rows — tasks are read
-- by id into a public projection that excludes the hint.

-- name: CreateArenaMatch :one
INSERT INTO arena_matches(task_id, task_version, section, mode, status, started_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, task_id, task_version, section, mode, status, winner_id,
          started_at, finished_at, created_at;

-- name: GetArenaMatch :one
SELECT id, task_id, task_version, section, mode, status, winner_id,
       started_at, finished_at, created_at
  FROM arena_matches WHERE id = $1;

-- name: UpdateArenaMatchStatus :execrows
UPDATE arena_matches
   SET status       = $2,
       started_at   = COALESCE($3, started_at),
       finished_at  = COALESCE($4, finished_at)
 WHERE id = $1;

-- name: SetArenaMatchWinner :execrows
UPDATE arena_matches
   SET status      = 'finished',
       winner_id   = $2,
       finished_at = $3
 WHERE id = $1;

-- name: SetArenaMatchTask :execrows
UPDATE arena_matches
   SET task_id      = $2,
       task_version = $3
 WHERE id = $1;

-- name: InsertArenaParticipant :exec
INSERT INTO arena_participants(match_id, user_id, team, elo_before)
VALUES ($1, $2, $3, $4)
ON CONFLICT (match_id, user_id) DO NOTHING;

-- name: ListArenaParticipants :many
SELECT match_id, user_id, team, elo_before, elo_after,
       suspicion_score, solve_time_ms, submitted_at
  FROM arena_participants
 WHERE match_id = $1
 ORDER BY team, user_id;

-- name: UpsertParticipantResult :execrows
UPDATE arena_participants
   SET solve_time_ms    = $3,
       suspicion_score  = $4,
       submitted_at     = $5
 WHERE match_id = $1 AND user_id = $2;

-- name: PickActiveTaskBySectionDifficulty :one
SELECT id, version, slug, title_ru, description_ru, difficulty, section,
       time_limit_sec, memory_limit_mb
  FROM tasks
 WHERE is_active = true AND section = $1 AND difficulty = $2
 ORDER BY random()
 LIMIT 1;

-- name: GetArenaTaskPublic :one
SELECT id, version, slug, title_ru, description_ru, difficulty, section,
       time_limit_sec, memory_limit_mb
  FROM tasks WHERE id = $1;

-- ListMyMatches and CountMyMatches power /api/v1/arena/matches/my. Both
-- accept optional mode/section filters via NULLIF(...) — sqlc emits string
-- params, so the application passes "" when the user wants no filter.
-- Joined to users for opponent username + avatar_url (added in 00010).

-- name: ListMyMatches :many
SELECT m.id                AS match_id,
       m.mode,
       m.section,
       m.status,
       m.winner_id,
       m.started_at,
       m.finished_at,
       me.elo_before       AS me_elo_before,
       me.elo_after        AS me_elo_after,
       opp.user_id         AS opponent_user_id,
       opp_user.username   AS opponent_username,
       opp_user.avatar_url AS opponent_avatar_url
  FROM arena_matches m
  JOIN arena_participants me  ON me.match_id  = m.id  AND me.user_id  = $1
  LEFT JOIN arena_participants opp
         ON opp.match_id = m.id AND opp.user_id <> $1
  LEFT JOIN users opp_user ON opp_user.id = opp.user_id
 WHERE m.status IN ('finished','cancelled')
   AND ($2::text = '' OR m.mode    = $2)
   AND ($3::text = '' OR m.section = $3)
 ORDER BY COALESCE(m.finished_at, m.created_at) DESC, m.id DESC
 LIMIT $4 OFFSET $5;

-- name: CountMyMatches :one
SELECT COUNT(*)::bigint AS total
  FROM arena_matches m
  JOIN arena_participants me ON me.match_id = m.id AND me.user_id = $1
 WHERE m.status IN ('finished','cancelled')
   AND ($2::text = '' OR m.mode    = $2)
   AND ($3::text = '' OR m.section = $3);
