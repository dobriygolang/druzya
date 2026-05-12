-- 00089_subscription_tiers.sql — BYOK (Bring Your Own Key) Pro-unlock flow.
--
-- Stream C MVP (subscription tier):
--   Free → AI-coach, atlas, codex, Hone basic, manual mock без AI feedback
--   Pro  → unlimited AI-mock pipelines, deep analytics, Cue premium, GCal sync
--   BYOK → юзер приносит свой LLM API key → Pro features unlocked free
--
-- Эта миграция вводит durable хранение BYOK-ключа per-user. Шифруется в
-- application layer через AES-256-GCM (см. services/subscription/infra/byok_encryptor.go);
-- БД хранит зашифрованный blob как TEXT (base64) для простоты транспорта в
-- pg.
--
-- Не дублирует существующий subscriptions table — там tier выдаётся через
-- Stripe/admin (paid Pro). BYOK живёт параллельно: при наличии валидного
-- ключа CheckTier UC отдаёт source='byok' и Pro features открыты.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE IF NOT EXISTS user_byok_keys (
    user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- 'openrouter' | 'groq' | 'cerebras' | 'anthropic' | 'openai'. Валидация в Go.
    provider          TEXT NOT NULL,
    -- Base64 of (nonce || sealed-ciphertext) from AES-256-GCM. Plain key
    -- никогда не пишется. Encryption key — env BYOK_ENCRYPTION_KEY.
    api_key_encrypted TEXT NOT NULL,
    -- nullable: NULL = ключ ещё не валидирован против test-endpoint'а.
    -- Set после успешного validateBYOKKey() (1-token min request).
    validated_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Compound index — пригодится для admin-аналитики «сколько Pro юзеров через
-- BYOK vs paid» (filter по validated_at IS NOT NULL).
CREATE INDEX IF NOT EXISTS idx_user_byok_keys_validated
    ON user_byok_keys(validated_at)
    WHERE validated_at IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS user_byok_keys;

-- +goose StatementEnd
