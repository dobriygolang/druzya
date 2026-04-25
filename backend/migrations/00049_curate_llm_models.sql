-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00049  Curate LLM model catalogue down to 6
-- ============================================================
-- Per product decision the user-facing picker should show:
--   - 3 free  (one virtual: druz9/turbo  — auto-routes free providers)
--   - 3 premium (one virtual: druz9/ultra — auto-routes paid providers,
--                 backed by the existing virtualChains map in
--                 backend/shared/pkg/llmchain/tier.go).
--
-- Anything else seeded by 00008 stays in the table but `is_enabled = false`,
-- so admin can re-enable individual rows without re-running this migration.
--
-- Tier enforcement: callers must check user subscription before accepting
-- a `tier='premium'` selection. The chain itself also rejects via
-- `TierCovers` — this catalogue is the UI contract.

-- 1) Soft-disable everything; we'll selectively re-enable below.
UPDATE llm_models SET is_enabled = FALSE;

-- 2) Ensure druz9/ultra exists. The virtual chain itself is hard-coded in
--    tier.go; the row here only drives the picker UI.
INSERT INTO llm_models (
    model_id, label, provider, provider_id, tier, is_virtual,
    use_for_arena, use_for_insight, use_for_mock, use_for_vacancies,
    sort_order, is_enabled
) VALUES
    ('druz9/ultra', 'Ультра ⚡ (премиум-роутинг)', 'druz9', 'druz9', 'premium', TRUE,
     TRUE, TRUE, TRUE, TRUE, 11, TRUE)
ON CONFLICT (model_id) DO UPDATE SET
    label      = EXCLUDED.label,
    tier       = EXCLUDED.tier,
    is_virtual = EXCLUDED.is_virtual,
    sort_order = EXCLUDED.sort_order,
    is_enabled = TRUE;

-- 3) Free tier — turbo + 2 reliable direct picks.
UPDATE llm_models SET
    is_enabled = TRUE, tier = 'free', sort_order = 1,
    label = 'Турбо ⚡ (авто-роутинг)'
 WHERE model_id = 'druz9/turbo';

UPDATE llm_models SET
    is_enabled = TRUE, tier = 'free', sort_order = 2,
    label = 'Llama 3.3 70B (Groq)'
 WHERE model_id = 'groq/llama-3.3-70b-versatile';

UPDATE llm_models SET
    is_enabled = TRUE, tier = 'free', sort_order = 3,
    label = 'GPT-4o mini'
 WHERE model_id = 'openai/gpt-4o-mini';

-- 4) Premium — ultra (above) + 2 top tier-2 picks.
UPDATE llm_models SET
    is_enabled = TRUE, tier = 'premium', sort_order = 12,
    label = 'Claude Sonnet 4'
 WHERE model_id = 'anthropic/claude-sonnet-4';

UPDATE llm_models SET
    is_enabled = TRUE, tier = 'premium', sort_order = 13,
    label = 'GPT-4o'
 WHERE model_id = 'openai/gpt-4o';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Roll back: re-enable everything seeded in 00008. We do NOT delete the
-- druz9/ultra row inserted above — leaving it enabled is harmless.
UPDATE llm_models SET is_enabled = TRUE
 WHERE model_id IN (
    'druz9/turbo','openai/gpt-4o-mini','qwen/qwen3-coder:free',
    'openai/gpt-oss-120b:free','minimax/minimax-m2.5:free',
    'liquid/lfm-2.5-1.2b-thinking:free','openai/gpt-4o',
    'anthropic/claude-sonnet-4','google/gemini-pro',
    'groq/llama-3.1-8b-instant','groq/llama-3.3-70b-versatile',
    'cerebras/llama3.1-8b','cerebras/llama3.3-70b',
    'mistral/mistral-small-latest','mistral/mistral-large-latest',
    'mistralai/mistral-7b'
 );
-- +goose StatementEnd
