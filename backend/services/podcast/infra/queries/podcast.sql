-- podcast queries consumed by sqlc (emitted into services/podcast/infra/db).

-- name: ListPodcastsWithProgress :many
-- Catalog join: every published podcast + the requesting user's progress row
-- (if any). Optional section filter — when @filter_by_section = FALSE the
-- second predicate is a no-op so the query collapses to "everything".
SELECT p.id,
       p.title_ru,
       p.title_en,
       p.description,
       p.section,
       p.duration_sec,
       p.audio_key,
       COALESCE(pp.listened_sec, 0)::int AS listened_sec,
       pp.completed_at
FROM podcasts p
LEFT JOIN podcast_progress pp
       ON pp.podcast_id = p.id AND pp.user_id = $1
WHERE p.is_published = TRUE
  AND (NOT sqlc.arg(filter_by_section)::bool OR p.section = sqlc.arg(section)::text)
ORDER BY p.created_at DESC;

-- name: GetPodcastByID :one
SELECT id, title_ru, title_en, description, section, duration_sec, audio_key, is_published, created_at
FROM podcasts
WHERE id = $1;

-- name: GetPodcastProgress :one
SELECT user_id, podcast_id, listened_sec, completed_at, updated_at
FROM podcast_progress
WHERE user_id = $1 AND podcast_id = $2;

-- name: UpsertPodcastProgress :exec
INSERT INTO podcast_progress(user_id, podcast_id, listened_sec, completed_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id, podcast_id) DO UPDATE
    SET listened_sec = EXCLUDED.listened_sec,
        completed_at = COALESCE(podcast_progress.completed_at, EXCLUDED.completed_at),
        updated_at   = now();
