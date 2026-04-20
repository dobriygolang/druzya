-- Queries consumed by sqlc for the editor domain. Mirrors the hand-rolled
-- adapter in infra/postgres.go.
--
-- NOTE: the editor domain never needs tasks.solution_hint — the TaskPublic
-- projection built elsewhere (e.g. /daily, /arena) is used when the caller
-- wants task details attached to the room. Keeping tasks out of this file
-- entirely avoids any risk of hint leakage from here.

-- name: CreateRoom :one
INSERT INTO editor_rooms (
    owner_id, type, task_id, language, is_frozen, expires_at
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, owner_id, type, task_id, language, is_frozen, expires_at, created_at;

-- name: GetRoom :one
SELECT id, owner_id, type, task_id, language, is_frozen, expires_at, created_at
  FROM editor_rooms
 WHERE id = $1;

-- name: UpdateRoomFreeze :one
UPDATE editor_rooms
   SET is_frozen = $2
 WHERE id = $1
 RETURNING id, owner_id, type, task_id, language, is_frozen, expires_at, created_at;

-- name: ExtendRoomExpires :execrows
UPDATE editor_rooms
   SET expires_at = $2
 WHERE id = $1;

-- name: AddParticipant :one
INSERT INTO editor_participants (room_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role
RETURNING room_id, user_id, role, joined_at;

-- name: ListParticipants :many
SELECT room_id, user_id, role, joined_at
  FROM editor_participants
 WHERE room_id = $1
 ORDER BY joined_at ASC;

-- name: GetParticipantRole :one
SELECT role
  FROM editor_participants
 WHERE room_id = $1 AND user_id = $2;
