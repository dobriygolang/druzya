-- +goose Up
-- +goose StatementBegin
--
-- 00044 — per-user vacancies-analyzer model + shared free-tier seed.
--
-- Two orthogonal changes bundled because both land alongside the
-- vacancies/profile migration off paid OpenRouter ids and onto the :free
-- lane:
--
--   1) users.ai_vacancies_model TEXT — mirrors ai_insight_model (migration
--      00032). Empty/NULL = "use server default". Premium validation lives
--      server-side against llm_models (same pattern as insight).
--      We intentionally keep it separate from ai_insight_model:
--      vacancies does strict-JSON extraction, insight does long-form prose,
--      and users are likely to want different picks per task.
--
--   2) llm_models.use_for_vacancies BOOLEAN — joins the use_for_{arena,
--      insight,mock} row of feature-surface flags. Serves GET /ai/models?
--      use=vacancies so the Settings picker only shows JSON-capable ids.
--
--   3) Seed the 4 :free models we want catalogued (migration 00043 already
--      switched copilot_quotas.models_allowed to them, but llm_models was
--      still on the old 5-row seed from 00033). With these rows, both
--      vacancies and profile/insight can read their catalogue from
--      llm_models instead of a hardcoded list.
--
-- Anti-fallback: if use_for_vacancies filter returns zero rows, the
-- frontend picker falls back to the "default" sentinel — no silent
-- server-side model swap.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ai_vacancies_model TEXT;

ALTER TABLE llm_models
    ADD COLUMN IF NOT EXISTS use_for_vacancies BOOLEAN NOT NULL DEFAULT FALSE;

-- Seed the OpenRouter :free lane. Flags per-task:
--
--   qwen3-coder        : strict JSON reliable → vacancies + insight
--   gpt-oss-120b       : strong prose, flaky JSON → insight only
--   minimax-m2.5       : medium-quality prose → insight only
--   liquid-lfm (thinking) : reasoning/short → insight only
--
-- gpt-4o-mini (existing free row) also handles strict JSON — flip its
-- use_for_vacancies bit so upgraded users with paid credits keep that
-- option in the picker.

INSERT INTO llm_models (
    model_id, label, provider, tier,
    use_for_arena, use_for_insight, use_for_mock, use_for_vacancies,
    sort_order
) VALUES
    ('qwen/qwen3-coder:free',             'Qwen3 Coder (free)',         'qwen',    'free',
        FALSE, TRUE,  FALSE, TRUE,  11),
    ('openai/gpt-oss-120b:free',          'GPT-OSS 120B (free)',        'openai',  'free',
        FALSE, TRUE,  FALSE, FALSE, 12),
    ('minimax/minimax-m2.5:free',         'MiniMax M2.5 (free)',        'minimax', 'free',
        FALSE, TRUE,  FALSE, FALSE, 13),
    ('liquid/lfm-2.5-1.2b-thinking:free', 'Liquid LFM 2.5 Thinking (free)', 'liquid', 'free',
        FALSE, TRUE,  FALSE, FALSE, 14)
ON CONFLICT (model_id) DO UPDATE SET
    -- Idempotent retrofit: update the use_for_* flags + label if the row
    -- already exists (e.g. admin added it manually before this migration).
    label             = EXCLUDED.label,
    use_for_insight   = EXCLUDED.use_for_insight,
    use_for_vacancies = EXCLUDED.use_for_vacancies,
    updated_at        = now();

-- Existing paid model that *does* handle strict JSON well.
UPDATE llm_models
   SET use_for_vacancies = TRUE,
       updated_at = now()
 WHERE model_id = 'openai/gpt-4o-mini';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DELETE FROM llm_models
 WHERE model_id IN (
    'qwen/qwen3-coder:free',
    'openai/gpt-oss-120b:free',
    'minimax/minimax-m2.5:free',
    'liquid/lfm-2.5-1.2b-thinking:free'
 );

UPDATE llm_models
   SET use_for_vacancies = FALSE,
       updated_at = now()
 WHERE model_id = 'openai/gpt-4o-mini';

ALTER TABLE llm_models DROP COLUMN IF EXISTS use_for_vacancies;
ALTER TABLE users      DROP COLUMN IF EXISTS ai_vacancies_model;

-- +goose StatementEnd
