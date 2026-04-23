-- +goose Up
-- +goose StatementBegin
--
-- 00032 — users.ai_insight_model: per-user AI Coach model selection.
--
-- Phase B (Wave-7) hardcoded the LLM model in OPENROUTER_INSIGHT_MODEL env
-- var, which forced every user onto whatever the operator picked. That is
-- wrong: free users should never trigger Claude/Opus calls (cost), and
-- premium users should be able to opt into the more capable models when
-- they want better insight quality.
--
-- This column stores the user's choice as a free-form OpenRouter model id
-- (e.g. "openai/gpt-4o-mini", "anthropic/claude-sonnet-4"). NULL means
-- "use server default" — the openrouter_insight client picks a tier-aware
-- free model in that case. Premium-locked models are gated server-side via
-- the existing user.tier check.
--
-- No backfill needed — NULL means default, which preserves current behavior.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ai_insight_model TEXT;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE users
    DROP COLUMN IF EXISTS ai_insight_model;
-- +goose StatementEnd
