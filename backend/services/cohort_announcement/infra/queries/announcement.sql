-- Cohort announcement feed queries (sqlc → infra/db).

-- name: CreateAnnouncement :one
INSERT INTO cohort_announcements(cohort_id, author_id, body, pinned, created_at, updated_at)
VALUES ($1, $2, $3, $4, now(), now())
RETURNING id, cohort_id, author_id, body, pinned, created_at, updated_at;

-- name: GetAnnouncementByID :one
SELECT a.id, a.cohort_id, a.author_id, a.body, a.pinned, a.created_at, a.updated_at,
       COALESCE(u.username, '')::text     AS author_username,
       COALESCE(u.display_name, '')::text AS author_display_name
  FROM cohort_announcements a
  LEFT JOIN users u ON u.id = a.author_id
 WHERE a.id = $1;

-- name: ListAnnouncementsByCohort :many
-- Pinned first then newest. Limit is server-capped in app layer.
SELECT a.id, a.cohort_id, a.author_id, a.body, a.pinned, a.created_at, a.updated_at,
       COALESCE(u.username, '')::text     AS author_username,
       COALESCE(u.display_name, '')::text AS author_display_name
  FROM cohort_announcements a
  LEFT JOIN users u ON u.id = a.author_id
 WHERE a.cohort_id = $1
 ORDER BY a.pinned DESC, a.created_at DESC
 LIMIT $2;

-- name: DeleteAnnouncement :execrows
DELETE FROM cohort_announcements WHERE id = $1;

-- name: ListReactionsForAnnouncements :many
-- Aggregated reactions for a batch of announcement_ids. Returns one row
-- per (announcement_id, emoji) with the total count + a bool of whether
-- the viewer themselves reacted with that emoji.
SELECT r.announcement_id, r.emoji,
       COUNT(*)::int                                                AS total,
       BOOL_OR(r.user_id = $2)                                      AS viewer_reacted
  FROM cohort_announcement_reactions r
 WHERE r.announcement_id = ANY($1::uuid[])
 GROUP BY r.announcement_id, r.emoji
 ORDER BY r.announcement_id, total DESC;

-- name: AddReaction :exec
-- Idempotent — duplicate (announcement, user, emoji) silently no-ops.
INSERT INTO cohort_announcement_reactions(announcement_id, user_id, emoji)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: RemoveReaction :execrows
DELETE FROM cohort_announcement_reactions
 WHERE announcement_id = $1 AND user_id = $2 AND emoji = $3;

-- name: CountReactions :one
SELECT COUNT(*)::int FROM cohort_announcement_reactions
 WHERE announcement_id = $1 AND emoji = $2;
