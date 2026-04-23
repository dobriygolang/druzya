-- +goose Up
-- +goose StatementBegin
--
-- 00029 — Telegram AI coach foundation (STRATEGIC SCAFFOLD).
--
-- See docs/strategic/tg-coach.md for the full roadmap.
--
-- Two tables:
--   - tg_user_link: 1:1 mapping druz9.uid <-> telegram chat_id, plus
--     push schedule preferences.
--   - tg_link_tokens: short-lived single-use tokens used by the deep link
--     `t.me/druz9_bot?start=<token>` to bind chat_id to user_id without
--     leaking sensitive identifiers.
--
-- Anti-fallback: when the bot receives a message from an unknown chat_id
-- it MUST reply with the deep-link instructions; it MUST NOT auto-create
-- an account on druz9's side.

CREATE TABLE IF NOT EXISTS tg_user_link (
    user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    chat_id        BIGINT NOT NULL UNIQUE,
    tg_username    TEXT,
    linked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    locale         TEXT NOT NULL DEFAULT 'ru',
    push_local_hh  INT  NOT NULL DEFAULT 9,
    push_tz        TEXT NOT NULL DEFAULT 'Europe/Moscow',
    paused_until   TIMESTAMPTZ,
    last_seen_at   TIMESTAMPTZ,
    CONSTRAINT tg_user_link_hh_valid CHECK (push_local_hh BETWEEN 0 AND 23)
);

CREATE INDEX IF NOT EXISTS idx_tg_user_link_chat
    ON tg_user_link(chat_id);

CREATE TABLE IF NOT EXISTS tg_link_tokens (
    token       TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tg_link_tokens_user
    ON tg_link_tokens(user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_tg_link_tokens_user;
DROP TABLE IF EXISTS tg_link_tokens;
DROP INDEX IF EXISTS idx_tg_user_link_chat;
DROP TABLE IF EXISTS tg_user_link;
-- +goose StatementEnd
