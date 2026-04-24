-- +goose Up
-- +goose StatementBegin

-- Switch the Free plan onto OpenRouter's zero-cost :free lane. The prior
-- default allowed only 'openai/gpt-4o-mini', which burns credits on
-- OpenRouter's billing — unsustainable for a free tier.
ALTER TABLE copilot_quotas
    ALTER COLUMN models_allowed
    SET DEFAULT ARRAY[
        'openai/gpt-oss-120b:free',
        'qwen/qwen3-coder:free',
        'minimax/minimax-m2.5:free',
        'liquid/lfm-2.5-1.2b-thinking:free'
    ]::TEXT[];

-- Retrofit existing free-plan quotas. Paid-plan rows keep whatever
-- allow-list their subscription wrote.
UPDATE copilot_quotas
   SET models_allowed = ARRAY[
        'openai/gpt-oss-120b:free',
        'qwen/qwen3-coder:free',
        'minimax/minimax-m2.5:free',
        'liquid/lfm-2.5-1.2b-thinking:free'
   ]::TEXT[],
       updated_at = now()
 WHERE plan = 'free';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE copilot_quotas
    ALTER COLUMN models_allowed
    SET DEFAULT ARRAY['openai/gpt-4o-mini']::TEXT[];

UPDATE copilot_quotas
   SET models_allowed = ARRAY['openai/gpt-4o-mini']::TEXT[],
       updated_at = now()
 WHERE plan = 'free';

-- +goose StatementEnd
