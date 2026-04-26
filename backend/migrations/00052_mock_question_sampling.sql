-- 00052_mock_question_sampling.sql
-- Per-stage question sampling: when a company's question pool grows
-- (admins seed 50–200 questions for SQL/HR/behavioral), a candidate
-- shouldn't get hit with every single one. We sample at materialise-
-- time using these caps.
--
-- NULL = legacy behaviour (take all active questions for the stage).
-- 0    = skip this source entirely.
-- N>0  = `ORDER BY random() LIMIT N`.
--
-- Two independent caps so an admin can say "always run the 5 default
-- HR questions + 3 random company-specific ones".

-- +goose Up
-- +goose StatementBegin
ALTER TABLE company_stages
  ADD COLUMN default_question_limit integer,
  ADD COLUMN company_question_limit integer;

COMMENT ON COLUMN company_stages.default_question_limit
  IS 'Cap on stage_default_questions sampled per attempt. NULL = take all, 0 = skip.';
COMMENT ON COLUMN company_stages.company_question_limit
  IS 'Cap on company_questions sampled per attempt. NULL = take all, 0 = skip.';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE company_stages
  DROP COLUMN IF EXISTS default_question_limit,
  DROP COLUMN IF EXISTS company_question_limit;
-- +goose StatementEnd
