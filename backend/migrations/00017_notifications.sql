-- +goose Up
-- user_notifications — стрим оповещений в UI (NotificationsPage и Bell-popup).
-- Отдельно от notifications_log (00007), которая отвечает за outbound delivery
-- по каналам (email/telegram/push) — здесь это in-app feed для самого UI.
--
-- channel: 'social' | 'match' | 'guild' | 'system' | 'challenges' | 'wins'
-- type: short identifier (challenge|win|friend_added|guild_war_started…)
CREATE TABLE IF NOT EXISTS user_notifications (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel     TEXT NOT NULL,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    payload     JSONB,
    priority    INT NOT NULL DEFAULT 0,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_un_user_created
    ON user_notifications (user_id, created_at DESC);
-- partial index ускоряет COUNT(*) FILTER (WHERE read_at IS NULL) и
-- list?unread=true (горячий путь для bell-badge).
CREATE INDEX IF NOT EXISTS idx_un_user_unread
    ON user_notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- notification_prefs — per-user toggle для каналов + silence_until.
-- channel_enabled: JSONB вида {"social":true,"match":true,"guild":false,...}
CREATE TABLE IF NOT EXISTS notification_prefs (
    user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    channel_enabled  JSONB NOT NULL DEFAULT '{}'::jsonb,
    silence_until    TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS notification_prefs;
DROP INDEX IF EXISTS idx_un_user_unread;
DROP INDEX IF EXISTS idx_un_user_created;
DROP TABLE IF EXISTS user_notifications;
