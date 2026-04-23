-- +goose Up
-- +goose StatementBegin
--
-- 00033 — llm_models: admin-editable registry of LLM models the platform
-- can dispatch via OpenRouter. Replaces the hardcoded enums.LLMModel list
-- in shared/enums and the canonicalModels() builder in
-- ai_native/ports/models.go.
--
-- Why a table:
--   - Adding a new model required a code change + deploy. Operators want
--     to flip on a new OpenRouter id (e.g. "openai/gpt-4o-2025-…") the
--     moment it ships, without waiting for an engineering rollout.
--   - Per-feature gating ("Arena yes, Insight no") used to live inside
--     the picker components. Centralising it here means every consumer
--     reads the same flags.
--
-- Tier semantics mirror the previous enums.LLMModel.IsPremium() check:
--   free    — every authenticated user may dispatch.
--   premium — gated server-side at session/insight creation by the
--             existing user.tier check.
--
-- Anti-fallback: if this table is empty, AI features expose an empty
-- catalogue and the frontend hides the picker. We do NOT seed a
-- "default" set at runtime — admins must add at least one model.
CREATE TABLE IF NOT EXISTS llm_models (
    id                     BIGSERIAL PRIMARY KEY,
    model_id               TEXT        NOT NULL UNIQUE,
    label                  TEXT        NOT NULL,
    provider               TEXT        NOT NULL,
    tier                   TEXT        NOT NULL DEFAULT 'free',
    is_enabled             BOOLEAN     NOT NULL DEFAULT TRUE,
    context_window         INT,
    cost_per_1k_input_usd  NUMERIC(8,6),
    cost_per_1k_output_usd NUMERIC(8,6),
    use_for_arena          BOOLEAN     NOT NULL DEFAULT TRUE,
    use_for_insight        BOOLEAN     NOT NULL DEFAULT TRUE,
    use_for_mock           BOOLEAN     NOT NULL DEFAULT TRUE,
    sort_order             INT         NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT llm_models_tier_valid CHECK (tier IN ('free','premium'))
);

CREATE INDEX IF NOT EXISTS llm_models_enabled_sort_idx
    ON llm_models (is_enabled, sort_order);

-- Seed mirrors the previous enums.LLMModel + IsPremium() classification
-- so existing callers (Arena AI opponent picker, Weekly Insight client,
-- Mock interview LLM) keep the same set on first deploy.
INSERT INTO llm_models (model_id, label, provider, tier, sort_order) VALUES
    ('openai/gpt-4o-mini',        'GPT-4o mini',     'openai',    'free',    10),
    ('mistralai/mistral-7b',      'Mistral 7B',      'mistral',   'free',    20),
    ('openai/gpt-4o',             'GPT-4o',          'openai',    'premium', 30),
    ('anthropic/claude-sonnet-4', 'Claude Sonnet 4', 'anthropic', 'premium', 40),
    ('google/gemini-pro',         'Gemini Pro',      'google',    'premium', 50)
ON CONFLICT (model_id) DO NOTHING;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS llm_models_enabled_sort_idx;
DROP TABLE IF EXISTS llm_models;
-- +goose StatementEnd
