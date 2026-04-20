-- slot queries consumed by sqlc (emitted into services/slot/infra/db).

-- name: CreateSlot :one
INSERT INTO slots(interviewer_id, starts_at, duration_min, section, difficulty, language, price_rub, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, 'available')
RETURNING id, interviewer_id, starts_at, duration_min, section, difficulty, language, price_rub, status, created_at;

-- name: GetSlot :one
SELECT id, interviewer_id, starts_at, duration_min, section, difficulty, language, price_rub, status, created_at
  FROM slots WHERE id = $1;

-- name: GetSlotForUpdate :one
-- SELECT ... FOR UPDATE inside a transaction so the book flow can atomically
-- flip status=available → booked without racing against concurrent callers.
SELECT id, interviewer_id, starts_at, duration_min, section, difficulty, language, price_rub, status, created_at
  FROM slots WHERE id = $1 FOR UPDATE;

-- name: ListAvailableSlotsBase :many
-- Base listing used when the caller does not pass optional filters. The
-- use-case layer composes richer filters via a hand-rolled SQL in postgres.go
-- (daily / arena do the same for dynamic WHERE clauses sqlc cannot represent).
SELECT id, interviewer_id, starts_at, duration_min, section, difficulty, language, price_rub, status, created_at
  FROM slots
 WHERE status = 'available'
   AND starts_at > now()
 ORDER BY starts_at ASC
 LIMIT $1;

-- name: ListByInterviewerInRange :many
-- Returns every slot owned by the interviewer whose [starts_at, ends_at)
-- overlaps the [from, to) window. Used for conflict detection at create time.
SELECT id, interviewer_id, starts_at, duration_min, section, difficulty, language, price_rub, status, created_at
  FROM slots
 WHERE interviewer_id = $1
   AND starts_at < $3::timestamptz
   AND (starts_at + make_interval(mins => duration_min)) > $2::timestamptz
 ORDER BY starts_at ASC;

-- name: UpdateSlotStatus :execrows
UPDATE slots SET status = $2 WHERE id = $1;

-- name: CreateBooking :one
INSERT INTO bookings(slot_id, candidate_id, meet_url, status)
VALUES ($1, $2, $3, 'confirmed')
RETURNING id, slot_id, candidate_id, meet_url, status, created_at;

-- name: GetBookingBySlotID :one
SELECT id, slot_id, candidate_id, meet_url, status, created_at
  FROM bookings WHERE slot_id = $1;

-- name: CancelBookingBySlotID :execrows
UPDATE bookings SET status = 'cancelled' WHERE slot_id = $1;

-- name: InterviewerReviewStats :one
-- Aggregate rating + review count across every booking owned by the interviewer.
-- Returns (avg, count) — avg is 0 when there are no reviews.
SELECT COALESCE(AVG(sr.rating)::float8, 0)::float8 AS avg_rating,
       COUNT(*)::int                               AS reviews_count
  FROM slot_reviews sr
  JOIN bookings b ON b.id = sr.booking_id
  JOIN slots    s ON s.id = b.slot_id
 WHERE s.interviewer_id = $1;
