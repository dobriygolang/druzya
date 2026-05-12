-- 00082_drop_vacancies.sql — D1 cleanup. Vacancies bounded context removed
-- 2026-05-11 (Sergey identity clarification): druz9 is an AI-guide, not a
-- job board. Vacancies surface mimicked LinkedIn/HeadHunter — off-identity.
--
-- Drops:
--   1. saved_vacancies table (per-user kanban over scraped postings)
--   2. users.ai_vacancies_model (user-chosen extractor LLM model id)
--   3. llm_models.use_for_vacancies (admin filter flag)
--
-- Code-side cleanup already shipped (this commit):
--   - backend/services/vacancies/* removed entirely
--   - backend/cmd/monolith/services/admin/vacancies.go removed
--   - backend/cmd/monolith/bootstrap/bootstrap.go — NewVacancies call dropped
--   - backend/cmd/monolith/bootstrap/router.go — public /vacancies paths dropped
--   - profile service — AIVacanciesModel handler + connect-RPC + repo methods dropped
--   - shared/pkg/llmchain — TaskVacanciesJSON const dropped (tests now use TaskInsightProse)
--   - shared/pkg/llmcache — TaskVacanciesJSON dropped from DefaultCacheableTasks
--   - shared/pkg/metrics — 3 vacancies counters dropped
--   - proto/druz9/v1/profile.proto — AIVacanciesModel messages + RPCs dropped
--   - frontend pages + queries + locales fully removed
--
-- D8 (arena enum value, reviewed_* columns) intentionally not bundled here —
-- arena enum removal requires CREATE TYPE … rebuild dance, and the reviewed_*
-- columns in interviewer_applications and hone_vocab_queue are active (the
-- audit conflated SRS analytics with the removed RPG review system).

-- +goose Up
-- +goose StatementBegin

DROP TABLE IF EXISTS saved_vacancies CASCADE;

ALTER TABLE users DROP COLUMN IF EXISTS ai_vacancies_model;

ALTER TABLE llm_models DROP COLUMN IF EXISTS use_for_vacancies;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- IRRECOVERABLE: saved_vacancies user rows + per-user ai_vacancies_model
-- preferences are destroyed. Down is a no-op — rollback is "restore from
-- backup". Re-introducing the surface requires a fresh design pass anyway
-- (the deletion is identity-driven, not technical).
SELECT 1;
-- +goose StatementEnd
