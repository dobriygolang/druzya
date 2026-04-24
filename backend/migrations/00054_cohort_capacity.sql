-- +goose Up
-- +goose StatementBegin
-- Phase 3.3: per-cohort capacity override. Until now the Phase-1
-- soft cap was a Go constant (cohortDomain.MaxMembersPhase1 = 50).
-- Owners now need to raise or lower the cap when they create / edit
-- a cohort — small 1-1 study groups want 10, bootcamps want 100+.
-- DEFAULT 50 keeps every existing row behaviourally identical.
ALTER TABLE cohorts ADD COLUMN capacity INT NOT NULL DEFAULT 50;
ALTER TABLE cohorts ADD CONSTRAINT cohorts_capacity_valid CHECK (capacity BETWEEN 2 AND 500);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE cohorts DROP CONSTRAINT IF EXISTS cohorts_capacity_valid;
ALTER TABLE cohorts DROP COLUMN IF EXISTS capacity;
-- +goose StatementEnd
