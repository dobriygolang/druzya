-- guild queries consumed by sqlc (emitted into services/guild/infra/db).
-- Contribution row storage is STUBBED in-memory at the infra layer — the
-- current migration does not have a war_contributions table. The queries
-- below cover what the domain persists on Postgres today.

-- name: UpsertGuild :one
INSERT INTO guilds(owner_id, name, emblem, guild_elo)
VALUES ($1, $2, $3, $4)
ON CONFLICT (name) DO UPDATE
    SET emblem    = EXCLUDED.emblem,
        guild_elo = EXCLUDED.guild_elo
RETURNING id, owner_id, name, emblem, guild_elo, created_at;

-- name: GetGuild :one
SELECT id, owner_id, name, emblem, guild_elo, created_at
  FROM guilds WHERE id = $1;

-- name: GetMyGuild :one
-- Resolve the single guild a user belongs to (guild_members has a UNIQUE index
-- on user_id, so at most one row matches).
SELECT g.id, g.owner_id, g.name, g.emblem, g.guild_elo, g.created_at
  FROM guilds g
  JOIN guild_members gm ON gm.guild_id = g.id
 WHERE gm.user_id = $1
 LIMIT 1;

-- name: ListGuildMembers :many
SELECT gm.guild_id,
       gm.user_id,
       u.username,
       gm.role,
       gm.assigned_section,
       gm.joined_at
  FROM guild_members gm
  JOIN users u ON u.id = gm.user_id
 WHERE gm.guild_id = $1
 ORDER BY gm.joined_at;

-- name: GetGuildMember :one
SELECT gm.guild_id,
       gm.user_id,
       u.username,
       gm.role,
       gm.assigned_section,
       gm.joined_at
  FROM guild_members gm
  JOIN users u ON u.id = gm.user_id
 WHERE gm.guild_id = $1 AND gm.user_id = $2;

-- name: GetCurrentWarForGuild :one
-- A war is "current" for a guild when the given instant falls between its
-- week_start (inclusive) and week_end (exclusive). We cast `now` to a DATE
-- because the migration stores week bounds as DATE, not TIMESTAMPTZ.
SELECT id, guild_a_id, guild_b_id, week_start, week_end,
       scores_a, scores_b, winner_id, created_at
  FROM guild_wars
 WHERE (guild_a_id = $1 OR guild_b_id = $1)
   AND week_start <= $2::date
   AND week_end   >  $2::date
 ORDER BY week_start DESC
 LIMIT 1;

-- name: GetWar :one
SELECT id, guild_a_id, guild_b_id, week_start, week_end,
       scores_a, scores_b, winner_id, created_at
  FROM guild_wars WHERE id = $1;

-- name: UpsertWarScoreA :execrows
-- Add `delta` to scores_a[section] (JSONB). COALESCE handles first-write.
UPDATE guild_wars
   SET scores_a = jsonb_set(
       scores_a,
       ARRAY[$2::text],
       to_jsonb(COALESCE((scores_a->>$2)::int, 0) + $3::int),
       true
   )
 WHERE id = $1;

-- name: UpsertWarScoreB :execrows
UPDATE guild_wars
   SET scores_b = jsonb_set(
       scores_b,
       ARRAY[$2::text],
       to_jsonb(COALESCE((scores_b->>$2)::int, 0) + $3::int),
       true
   )
 WHERE id = $1;

-- name: SetWarWinner :execrows
UPDATE guild_wars
   SET winner_id = $2
 WHERE id = $1;
