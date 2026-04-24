-- cohort queries consumed by sqlc (emitted into services/cohort/infra/db).
-- Contribution row storage is STUBBED in-memory at the infra layer — the
-- current migration does not have a war_contributions table. The queries
-- below cover what the domain persists on Postgres today.

-- name: UpsertCohort :one
INSERT INTO cohorts(owner_id, name, emblem, cohort_elo)
VALUES ($1, $2, $3, $4)
ON CONFLICT (name) DO UPDATE
    SET emblem    = EXCLUDED.emblem,
        cohort_elo = EXCLUDED.cohort_elo
RETURNING id, owner_id, name, emblem, cohort_elo, created_at;

-- name: GetCohort :one
SELECT id, owner_id, name, emblem, cohort_elo, created_at
  FROM cohorts WHERE id = $1;

-- name: GetMyCohort :one
-- Resolve the single cohort a user belongs to (cohort_members has a UNIQUE index
-- on user_id, so at most one row matches).
SELECT g.id, g.owner_id, g.name, g.emblem, g.cohort_elo, g.created_at
  FROM cohorts g
  JOIN cohort_members gm ON gm.cohort_id = g.id
 WHERE gm.user_id = $1
 LIMIT 1;

-- name: ListCohortMembers :many
SELECT gm.cohort_id,
       gm.user_id,
       u.username,
       gm.role,
       gm.assigned_section,
       gm.joined_at
  FROM cohort_members gm
  JOIN users u ON u.id = gm.user_id
 WHERE gm.cohort_id = $1
 ORDER BY gm.joined_at;

-- name: GetCohortMember :one
SELECT gm.cohort_id,
       gm.user_id,
       u.username,
       gm.role,
       gm.assigned_section,
       gm.joined_at
  FROM cohort_members gm
  JOIN users u ON u.id = gm.user_id
 WHERE gm.cohort_id = $1 AND gm.user_id = $2;

-- name: GetCurrentWarForCohort :one
-- A war is "current" for a cohort when the given instant falls between its
-- week_start (inclusive) and week_end (exclusive). We cast `now` to a DATE
-- because the migration stores week bounds as DATE, not TIMESTAMPTZ.
SELECT id, cohort_a_id, cohort_b_id, week_start, week_end,
       scores_a, scores_b, winner_id, created_at
  FROM cohort_wars
 WHERE (cohort_a_id = $1 OR cohort_b_id = $1)
   AND week_start <= $2::date
   AND week_end   >  $2::date
 ORDER BY week_start DESC
 LIMIT 1;

-- name: GetWar :one
SELECT id, cohort_a_id, cohort_b_id, week_start, week_end,
       scores_a, scores_b, winner_id, created_at
  FROM cohort_wars WHERE id = $1;

-- name: UpsertWarScoreA :execrows
-- Add `delta` to scores_a[section] (JSONB). COALESCE handles first-write.
UPDATE cohort_wars
   SET scores_a = jsonb_set(
       scores_a,
       ARRAY[$2::text],
       to_jsonb(COALESCE((scores_a->>$2)::int, 0) + $3::int),
       true
   )
 WHERE id = $1;

-- name: UpsertWarScoreB :execrows
UPDATE cohort_wars
   SET scores_b = jsonb_set(
       scores_b,
       ARRAY[$2::text],
       to_jsonb(COALESCE((scores_b->>$2)::int, 0) + $3::int),
       true
   )
 WHERE id = $1;

-- name: SetWarWinner :execrows
UPDATE cohort_wars
   SET winner_id = $2
 WHERE id = $1;

-- name: ListTopCohorts :many
-- Global cohort leaderboard. We surface the existing cohort_elo column as the
-- primary ranking metric (the bible's "elo_total" — cohorts carry a single
-- ELO, members aren't summed, so this is the right pivot). members_count is
-- a simple correlated count. wars_won counts every cohort_wars row where
-- this cohort is the recorded winner. The ORDER BY is deterministic on ties
-- (elo desc, id asc) so the cache is consistent across reads.
SELECT g.id,
       g.name,
       g.emblem,
       g.cohort_elo,
       (SELECT COUNT(*)::int FROM cohort_members gm WHERE gm.cohort_id = g.id)        AS members_count,
       (SELECT COUNT(*)::int FROM cohort_wars gw WHERE gw.winner_id = g.id)          AS wars_won
  FROM cohorts g
 ORDER BY g.cohort_elo DESC, g.id ASC
 LIMIT $1;
