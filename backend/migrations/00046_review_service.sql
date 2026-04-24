-- +goose Up
-- +goose StatementBegin
-- Wave-12 / SLOT M3: split slot_reviews into its own bounded context (review).
-- Rename to `reviews` and add fields needed by the new RPCs:
--   - interviewer_id: denormalised so the per-interviewer query doesn't need
--     to JOIN bookings -> slots every time (slots is now a different service).
--   - updated_at: lets ListReviewsByInterviewer order by latest edit. We
--     don't expose Update yet, but the column lays the groundwork.
ALTER TABLE slot_reviews RENAME TO reviews;
ALTER TABLE reviews ADD COLUMN interviewer_id UUID;
ALTER TABLE reviews ADD COLUMN updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill interviewer_id for existing rows (if any) by joining bookings → slots.
UPDATE reviews r
   SET interviewer_id = s.interviewer_id
  FROM bookings b
  JOIN slots    s ON s.id = b.slot_id
 WHERE b.id = r.booking_id
   AND r.interviewer_id IS NULL;

ALTER TABLE reviews ALTER COLUMN interviewer_id SET NOT NULL;
ALTER TABLE reviews ADD CONSTRAINT reviews_interviewer_fk
    FOREIGN KEY (interviewer_id) REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX idx_reviews_interviewer ON reviews(interviewer_id, created_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_reviews_interviewer;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_interviewer_fk;
ALTER TABLE reviews DROP COLUMN IF EXISTS updated_at;
ALTER TABLE reviews DROP COLUMN IF EXISTS interviewer_id;
ALTER TABLE reviews RENAME TO slot_reviews;
-- +goose StatementEnd
