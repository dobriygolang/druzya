-- review queries (sqlc → services/review/infra/db).

-- name: CreateReview :one
-- Booking_id is the PK so a duplicate INSERT raises a unique-violation that
-- the app layer maps to ErrAlreadyReviewed.
INSERT INTO reviews(booking_id, reviewer_id, interviewer_id, rating, feedback, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, now(), now())
RETURNING booking_id, reviewer_id, interviewer_id, rating, feedback, created_at, updated_at;

-- name: GetReviewByBooking :one
SELECT booking_id, reviewer_id, interviewer_id, rating, feedback, created_at, updated_at
  FROM reviews WHERE booking_id = $1;

-- name: ListReviewsByInterviewer :many
SELECT booking_id, reviewer_id, interviewer_id, rating, feedback, created_at, updated_at
  FROM reviews
 WHERE interviewer_id = $1
 ORDER BY created_at DESC
 LIMIT $2;

-- name: GetInterviewerStats :one
-- avg_rating is 0 when there are no reviews — caller decides whether to
-- surface the stat or treat zero as "no data" (slot does the latter).
SELECT COALESCE(AVG(rating)::float8, 0)::float8 AS avg_rating,
       COUNT(*)::int                            AS reviews_count
  FROM reviews
 WHERE interviewer_id = $1;
