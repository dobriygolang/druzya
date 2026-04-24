-- review queries (sqlc → services/review/infra/db).

-- name: CreateReview :one
-- (booking_id, direction) is the composite PK; a duplicate raises
-- 23505 which the app layer maps to ErrAlreadyReviewed.
INSERT INTO reviews(booking_id, direction, reviewer_id, interviewer_id, subject_id, rating, feedback, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
RETURNING booking_id, direction, reviewer_id, interviewer_id, subject_id, rating, feedback, created_at, updated_at;

-- name: GetReviewByBookingDirection :one
SELECT booking_id, direction, reviewer_id, interviewer_id, subject_id, rating, feedback, created_at, updated_at
  FROM reviews WHERE booking_id = $1 AND direction = $2;

-- name: ListReviewsBySubject :many
-- Filters on subject_id (denormalized) so the same query backs both the
-- interviewer's public card and the candidate's own card.
SELECT booking_id, direction, reviewer_id, interviewer_id, subject_id, rating, feedback, created_at, updated_at
  FROM reviews
 WHERE subject_id = $1
 ORDER BY created_at DESC
 LIMIT $2;

-- name: GetSubjectStats :one
-- avg_rating is 0 when there are no reviews — caller decides whether to
-- surface the stat or treat zero as "no data" (slot does the latter).
SELECT COALESCE(AVG(rating)::float8, 0)::float8 AS avg_rating,
       COUNT(*)::int                            AS reviews_count
  FROM reviews
 WHERE subject_id = $1;
