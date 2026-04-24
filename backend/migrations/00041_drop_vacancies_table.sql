-- +goose Up
-- 00041 — drop the legacy `vacancies` table.
--
-- Phase 3 moves the parsed catalogue fully in-process (services/vacancies/
-- infra/cache). Persistent storage of the parser output is gone — we don't
-- need to "store" data we can re-pull from the source every 15 min, and the
-- migration in 00040 already moved the still-meaningful kanban state to a
-- self-contained snapshot model.
--
-- CASCADE drops the indexes (idx_vacancies_skills, idx_vacancies_source_posted)
-- in lock-step.
DROP TABLE IF EXISTS vacancies CASCADE;

-- +goose Down
-- Forward-only — re-creating a 1.5M-row table from scratch is meaningless.
-- The cache is the source of truth for parsed postings now.
SELECT 1;
