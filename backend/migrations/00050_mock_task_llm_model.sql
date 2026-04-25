-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00050  Per-task LLM model override
-- ============================================================
-- Lets admins pin a specific model id (matching llm_models.model_id) on
-- a single mock_tasks row. The orchestrator picks this up before falling
-- back to the strictness-profile / global default chain.
--
-- Plain TEXT (not FK) by design: llm_models is a tiny admin-curated
-- catalogue; a missing/typo'd id should surface as "model not found"
-- at runtime rather than blocking the seed write. Same shape as the
-- ai_*_model columns on users.

ALTER TABLE mock_tasks
  ADD COLUMN IF NOT EXISTS llm_model TEXT;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE mock_tasks DROP COLUMN IF EXISTS llm_model;
-- +goose StatementEnd
