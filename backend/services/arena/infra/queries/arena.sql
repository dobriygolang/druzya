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
