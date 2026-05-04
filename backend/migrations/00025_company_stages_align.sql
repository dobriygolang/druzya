-- +goose Up
-- +goose StatementBegin

-- 00025_company_stages_align.sql
--
-- Aligns `company_stages` со схемой, которую ожидает Go-код в
-- backend/services/mock_interview/infra/postgres_company_stages.go.
-- 00002_mock_schema_align.sql (in-baseline) переделал 5 mock-таблиц
-- но company_stages остался в старой шейпе (id/company_id/name/sort_order),
-- а runtime SELECT'ит другие колонки → 500 на POST /api/v1/mock/pipelines.
--
-- Заодно создаём ENUM `mock_task_language`, на который кастится
-- language_pool через `$5::mock_task_language[]` в Upsert.
--
-- Strategy: DROP + CREATE — таблица admin-curated CMS, user data в неё
-- не пишется (only через admin UI / seed). Ничего не теряется.

-- ── ENUM (idempotent через DO/IF NOT EXISTS) ──────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mock_task_language') THEN
        CREATE TYPE mock_task_language AS ENUM (
            'any', 'go', 'python', 'java', 'kotlin', 'cpp', 'js', 'ts', 'rust', 'sql'
        );
    END IF;
END $$;

DROP TABLE IF EXISTS company_stages CASCADE;

CREATE TABLE company_stages (
    company_id                UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    stage_kind                TEXT NOT NULL,
    ordinal                   INT  NOT NULL DEFAULT 0,
    optional                  BOOLEAN NOT NULL DEFAULT FALSE,
    language_pool             mock_task_language[] NOT NULL DEFAULT '{}',
    task_pool_ids             UUID[] NOT NULL DEFAULT '{}',
    ai_strictness_profile_id  UUID REFERENCES ai_strictness_profiles(id) ON DELETE SET NULL,
    default_question_limit    INT,
    company_question_limit    INT,
    PRIMARY KEY (company_id, stage_kind)
);

CREATE INDEX company_stages_company_ordinal_idx
    ON company_stages (company_id, ordinal);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- DROP/CREATE: rollback drops the DB
-- +goose StatementEnd
