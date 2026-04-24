-- +goose Up
-- +goose StatementBegin
-- M4b: bidirectional reviews. Each completed booking now allows TWO
-- review rows — one from each side (candidate→interviewer and
-- interviewer→candidate). The PK becomes composite (booking_id, direction).
-- subject_id (the user being reviewed) is denormalized off direction so
-- ListReviewsByInterviewer / ListReviewsByCandidate stay one-row queries.
ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'candidate_to_interviewer';
ALTER TABLE reviews ADD COLUMN subject_id UUID;

-- Backfill: existing rows are all candidate→interviewer; subject = the
-- interviewer denormalised earlier (see migration 00048).
UPDATE reviews SET subject_id = interviewer_id WHERE subject_id IS NULL;

ALTER TABLE reviews ALTER COLUMN subject_id SET NOT NULL;
ALTER TABLE reviews ADD CONSTRAINT reviews_subject_fk
    FOREIGN KEY (subject_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE reviews ADD CONSTRAINT reviews_direction_valid
    CHECK (direction IN ('candidate_to_interviewer', 'interviewer_to_candidate'));

-- Drop the booking_id-only PK so two rows per booking become legal,
-- replace with the composite (booking_id, direction). The original PK
-- was created as `slot_reviews_pkey` back in migration 00005 and
-- Postgres does NOT auto-rename constraints when a table is renamed,
-- so we look it up dynamically instead of hard-coding a name.
-- +goose StatementEnd
-- +goose StatementBegin
DO $$
DECLARE
    pk_name text;
BEGIN
    SELECT conname INTO pk_name
      FROM pg_constraint
     WHERE conrelid = 'reviews'::regclass
       AND contype  = 'p';
    IF pk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE reviews DROP CONSTRAINT %I', pk_name);
    END IF;
END
$$;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE reviews ADD PRIMARY KEY (booking_id, direction);

-- The old (interviewer_id, created_at DESC) index served the public
-- interviewer-card query. Generalise it on subject_id so the same
-- index serves the candidate-side reverse lookup too.
DROP INDEX IF EXISTS idx_reviews_interviewer;
CREATE INDEX idx_reviews_subject ON reviews(subject_id, created_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_reviews_subject;
ALTER TABLE reviews DROP CONSTRAINT reviews_pkey;
ALTER TABLE reviews ADD PRIMARY KEY (booking_id);
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_direction_valid;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_subject_fk;
ALTER TABLE reviews DROP COLUMN IF EXISTS subject_id;
ALTER TABLE reviews DROP COLUMN IF EXISTS direction;
CREATE INDEX idx_reviews_interviewer ON reviews(interviewer_id, created_at DESC);
-- +goose StatementEnd
