-- +goose Up
-- support_tickets — заявки на поддержку из формы /help.
-- Когда юзер заполняет форму:
--   1. Запись пишется сюда (audit + чтобы потом отвечать через админку)
--   2. Notify-бот шлёт alert в support-чат в Telegram
--   3. Юзер получает ticket_id, ответ доходит через @druz9_support бота
--      (привязывается по contact_handle, см. notify/handlers).
CREATE TABLE IF NOT EXISTS support_tickets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- user_id: NULL если юзер не залогинен (анонимная заявка по email/tg).
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    -- contact_kind: "email" | "telegram" — куда пушим ответ.
    contact_kind    TEXT NOT NULL CHECK (contact_kind IN ('email', 'telegram')),
    -- contact_value: лежит как есть, нормализация — на стороне notify-сервиса.
    contact_value   TEXT NOT NULL,
    subject         TEXT NOT NULL DEFAULT '',
    message         TEXT NOT NULL,
    -- status: open / in_progress / resolved / closed. closed = игнорим повторные.
    status          TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','in_progress','resolved','closed')),
    -- Внутренний ответ оператора (видит только админка).
    internal_note   TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_created
    ON support_tickets(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user
    ON support_tickets(user_id) WHERE user_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_support_tickets_user;
DROP INDEX IF EXISTS idx_support_tickets_status_created;
DROP TABLE IF EXISTS support_tickets;
