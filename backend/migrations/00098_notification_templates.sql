-- 00098_notification_templates.sql — Admin Phase 2: notification templates.
--
-- Powers admin-editable compose notifications для услуг типа inactive-user
-- re-engagement, streak alerts, mini-mock due reminders. Каждая запись —
-- per-channel template; notify service выбирает template по slug + channel
-- + подставляет variables.
--
-- Channels enumerable но stored as TEXT для гибкости (in_app будущая фича).
-- Subject empty для tg / push / in_app (только body). Email & in-app
-- используют subject_template как title/headline.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE IF NOT EXISTS notification_templates (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug             TEXT UNIQUE NOT NULL,
    channel          TEXT NOT NULL,
    subject_template TEXT NOT NULL DEFAULT '',
    body_template    TEXT NOT NULL,
    variables        JSONB NOT NULL DEFAULT '[]'::jsonb,
    description      TEXT NOT NULL DEFAULT '',
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_templates_active
    ON notification_templates(is_active, channel);

INSERT INTO notification_templates (slug, channel, subject_template, body_template, variables, description, is_active) VALUES
('user_inactive_4d_email',
 'email',
 '{{username}}, давно не виделись',
 'Твоя trajectory просела за {{days}} дней. Открой план: {{link}}',
 '["{{username}}","{{days}}","{{link}}"]'::jsonb,
 'Re-engagement email после 4d inactivity',
 TRUE),
('streak_at_risk_tg',
 'tg',
 '',
 '🔥 {{streak}}-day streak в опасности — log что-нибудь сегодня: {{link}}',
 '["{{streak}}","{{link}}"]'::jsonb,
 'Streak save notification через TG bot',
 TRUE),
('mini_mock_due_email',
 'email',
 'Mini-mock устарел',
 'Перепройди — это 20 минут, и daily plan адаптируется: {{link}}',
 '["{{link}}"]'::jsonb,
 'Reminder пройти mini-mock после 14d',
 TRUE)
ON CONFLICT (slug) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS notification_templates;

-- +goose StatementEnd
