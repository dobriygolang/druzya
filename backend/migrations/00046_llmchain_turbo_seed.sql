-- +goose Up
-- +goose StatementBegin
--
-- 00046 — llmchain rollout: Turbo virtual model + per-row provider + seed.
--
-- (Renumbered from 00045 after a collision with 00045_slot_meet_url.sql
-- landed on main between branches.)
--
-- Paired with the new shared/pkg/llmchain module. Three schema changes
-- plus a seed pass, landed in one migration because anything less leaves
-- the catalogue in an inconsistent state (FE picker showing free Groq
-- models the backend can't route, or vice versa).
--
-- 1) llm_models.provider_id TEXT — redundant with the "<provider>/<model>"
--    convention in model_id, but explicit is better than split-string
--    parsing at every repo read. Admin UI can also filter/edit on it
--    without having to assume the prefix format.
--
-- 2) llm_models.is_virtual BOOLEAN — marks rows that are NOT a real
--    upstream id but a chain-level pseudo-model. "druz9/turbo" is the
--    first and (for now) only one. Admin CMS uses this flag to disable
--    "model_id" editing on virtual rows (it's a contract, not a config).
--
-- 3) users.ai_default_model TEXT — the user's global default when no
--    feature-specific pick is set. Empty/NULL = "druz9/turbo". This lets
--    us change the fleet-wide default by changing one column without
--    touching per-user settings individually.
--
-- 4) Seed pass — adds Groq/Cerebras/Mistral free-tier models + the
--    druz9/turbo virtual row. Re-flags the old OpenRouter :free rows
--    (added in 00044) with their provider_id so the repo can dispatch.
--
-- Backfill: every existing user (all rows in users) gets
-- ai_default_model='druz9/turbo' unless they had already pinned a
-- specific ai_vacancies_model / ai_insight_model — those stay (user
-- chose deliberately, don't override).

ALTER TABLE llm_models
    ADD COLUMN IF NOT EXISTS provider_id TEXT NOT NULL DEFAULT 'openrouter',
    ADD COLUMN IF NOT EXISTS is_virtual  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ai_default_model TEXT;

-- Backfill provider_id for pre-existing rows. Every OpenRouter id is of
-- the form "vendor/model" — but the row's VENDOR is not the provider
-- that serves it (openai/gpt-4o is served BY OpenRouter, the "openai"
-- prefix is the vendor within the OpenRouter catalogue). So every
-- pre-existing row gets provider_id='openrouter'.
UPDATE llm_models SET provider_id = 'openrouter' WHERE provider_id IS NULL OR provider_id = '';

-- ─────────────────────────────────────────────────────────────────────
-- Turbo — the virtual router model.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO llm_models (
    model_id, label, provider, provider_id, tier, is_virtual,
    use_for_arena, use_for_insight, use_for_mock, use_for_vacancies,
    sort_order
) VALUES (
    'druz9/turbo', 'Турбо ⚡ (авто-роутинг)', 'druz9', 'druz9', 'free', TRUE,
    TRUE, TRUE, TRUE, TRUE, 1     -- sort_order=1 → first in every picker
)
ON CONFLICT (model_id) DO UPDATE SET
    label            = EXCLUDED.label,
    provider         = EXCLUDED.provider,
    provider_id      = EXCLUDED.provider_id,
    is_virtual       = EXCLUDED.is_virtual,
    use_for_arena    = TRUE,
    use_for_insight  = TRUE,
    use_for_mock     = TRUE,
    use_for_vacancies= TRUE,
    sort_order       = 1,
    updated_at       = now();

-- ─────────────────────────────────────────────────────────────────────
-- Groq (primary chain hop) — 2 Llama variants.
--
-- llama-3.1-8b-instant → strict-JSON extractor workload (vacancies).
-- llama-3.3-70b-versatile → reasoning / prose (insight, copilot).
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO llm_models (
    model_id, label, provider, provider_id, tier,
    use_for_arena, use_for_insight, use_for_mock, use_for_vacancies,
    sort_order
) VALUES
    ('groq/llama-3.1-8b-instant',     'Llama 3.1 8B (Groq)',   'groq', 'groq', 'free',
        FALSE, FALSE, FALSE, TRUE,  20),
    ('groq/llama-3.3-70b-versatile',  'Llama 3.3 70B (Groq)',  'groq', 'groq', 'free',
        TRUE,  TRUE,  TRUE,  TRUE,  21)
ON CONFLICT (model_id) DO UPDATE SET
    label       = EXCLUDED.label,
    provider    = EXCLUDED.provider,
    provider_id = EXCLUDED.provider_id,
    updated_at  = now();

-- ─────────────────────────────────────────────────────────────────────
-- Cerebras (secondary chain hop).
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO llm_models (
    model_id, label, provider, provider_id, tier,
    use_for_arena, use_for_insight, use_for_mock, use_for_vacancies,
    sort_order
) VALUES
    ('cerebras/llama3.1-8b',    'Llama 3.1 8B (Cerebras)',  'cerebras', 'cerebras', 'free',
        FALSE, FALSE, FALSE, TRUE,  30),
    ('cerebras/llama3.3-70b',   'Llama 3.3 70B (Cerebras)', 'cerebras', 'cerebras', 'free',
        TRUE,  TRUE,  TRUE,  TRUE,  31)
ON CONFLICT (model_id) DO UPDATE SET
    label       = EXCLUDED.label,
    provider    = EXCLUDED.provider,
    provider_id = EXCLUDED.provider_id,
    updated_at  = now();

-- ─────────────────────────────────────────────────────────────────────
-- Mistral (optional chain hop; excluded from DefaultChainOrder).
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO llm_models (
    model_id, label, provider, provider_id, tier,
    use_for_arena, use_for_insight, use_for_mock, use_for_vacancies,
    sort_order
) VALUES
    ('mistral/mistral-small-latest', 'Mistral Small (free)',  'mistral', 'mistral', 'free',
        FALSE, FALSE, FALSE, TRUE,  40),
    ('mistral/mistral-large-latest', 'Mistral Large (free)',  'mistral', 'mistral', 'free',
        TRUE,  TRUE,  TRUE,  FALSE, 41)
ON CONFLICT (model_id) DO UPDATE SET
    label       = EXCLUDED.label,
    provider    = EXCLUDED.provider,
    provider_id = EXCLUDED.provider_id,
    updated_at  = now();

-- ─────────────────────────────────────────────────────────────────────
-- Backfill user defaults. Only touch rows where the column is NULL so
-- re-running the migration is idempotent.
-- ─────────────────────────────────────────────────────────────────────
UPDATE users SET ai_default_model = 'druz9/turbo' WHERE ai_default_model IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- copilot_quotas: default allow-list switches onto Turbo + Groq models.
-- Retrofit existing free rows (0043 switched them onto OpenRouter :free;
-- now that Groq is in play, free tier should prefer it).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE copilot_quotas
    ALTER COLUMN models_allowed
    SET DEFAULT ARRAY[
        'druz9/turbo',
        'groq/llama-3.3-70b-versatile',
        'groq/llama-3.1-8b-instant',
        'cerebras/llama3.3-70b',
        'openai/gpt-oss-120b:free',
        'qwen/qwen3-coder:free'
    ]::TEXT[];

UPDATE copilot_quotas
   SET models_allowed = ARRAY[
        'druz9/turbo',
        'groq/llama-3.3-70b-versatile',
        'groq/llama-3.1-8b-instant',
        'cerebras/llama3.3-70b',
        'openai/gpt-oss-120b:free',
        'qwen/qwen3-coder:free'
   ]::TEXT[],
       updated_at = now()
 WHERE plan = 'free';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE copilot_quotas
    ALTER COLUMN models_allowed
    SET DEFAULT ARRAY[
        'openai/gpt-oss-120b:free',
        'qwen/qwen3-coder:free',
        'minimax/minimax-m2.5:free',
        'liquid/lfm-2.5-1.2b-thinking:free'
    ]::TEXT[];

DELETE FROM llm_models WHERE model_id IN (
    'druz9/turbo',
    'groq/llama-3.1-8b-instant',
    'groq/llama-3.3-70b-versatile',
    'cerebras/llama3.1-8b',
    'cerebras/llama3.3-70b',
    'mistral/mistral-small-latest',
    'mistral/mistral-large-latest'
);

ALTER TABLE users      DROP COLUMN IF EXISTS ai_default_model;
ALTER TABLE llm_models DROP COLUMN IF EXISTS is_virtual;
ALTER TABLE llm_models DROP COLUMN IF EXISTS provider_id;

-- +goose StatementEnd
