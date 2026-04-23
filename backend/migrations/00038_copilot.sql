-- +goose Up
-- +goose StatementBegin

-- copilot_conversations — one per Analyze call that seeded a thread.
-- Follow-up Chat turns append messages to an existing row.
CREATE TABLE copilot_conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    model       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- History-list query path: WHERE user_id=$1 ORDER BY updated_at DESC.
CREATE INDEX IF NOT EXISTS idx_copilot_conversations_user_updated
    ON copilot_conversations(user_id, updated_at DESC);

-- copilot_messages — ordered turns within a conversation.
-- has_screenshot is a FLAG ONLY. The screenshot bytes flow through the server
-- into the LLM and are discarded — never persisted. See docs/copilot-architecture.md.
CREATE TABLE copilot_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    has_screenshot  BOOLEAN NOT NULL DEFAULT FALSE,
    tokens_in       INT NOT NULL DEFAULT 0,
    tokens_out      INT NOT NULL DEFAULT 0,
    latency_ms      INT NOT NULL DEFAULT 0,
    rating          SMALLINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT copilot_messages_role_valid
        CHECK (role IN ('system','user','assistant')),
    CONSTRAINT copilot_messages_rating_valid
        CHECK (rating IS NULL OR rating IN (-1, 0, 1))
);

-- Conversation-detail query path: WHERE conversation_id=$1 ORDER BY created_at ASC.
CREATE INDEX IF NOT EXISTS idx_copilot_messages_conv_created
    ON copilot_messages(conversation_id, created_at);

-- copilot_quotas — per-user rate-limit / plan bucket.
-- A row is lazily created on first Analyze call; defaults match the "free" plan.
CREATE TABLE copilot_quotas (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan            TEXT NOT NULL DEFAULT 'free',
    requests_used   INT NOT NULL DEFAULT 0,
    requests_cap    INT NOT NULL DEFAULT 20,
    resets_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 day'),
    models_allowed  TEXT[] NOT NULL DEFAULT ARRAY['openai/gpt-4o-mini']::TEXT[],
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT copilot_quotas_plan_valid
        CHECK (plan IN ('free','seeker','ascendant'))
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_copilot_messages_conv_created;
DROP INDEX IF EXISTS idx_copilot_conversations_user_updated;
DROP TABLE IF EXISTS copilot_quotas;
DROP TABLE IF EXISTS copilot_messages;
DROP TABLE IF EXISTS copilot_conversations;
-- +goose StatementEnd
