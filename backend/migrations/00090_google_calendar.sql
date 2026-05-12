-- 00090_google_calendar.sql — Stream E MVP: Google Calendar two-way sync.
--
-- Заменяет deleted-в-04 personal_events: external calendar through OAuth2
-- вместо локального custom-events. Frontend Hone Calendar (renderer) показывает
-- объединённый view (Google + local pending push). Periodic pull cron (5 min)
-- mirrorит Google → events_synced; PushEvent UC posts back при создании в Hone.
--
-- Tokens хранятся encrypted (AES-256-GCM, env GOOGLE_TOKEN_ENCRYPTION_KEY).
-- Pattern зеркалит services/subscription/infra/byok_encryptor.go.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE user_google_credentials (
    user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token_encrypted  TEXT NOT NULL,
    refresh_token_encrypted TEXT NOT NULL,
    expiry                  TIMESTAMPTZ NOT NULL,
    scopes                  TEXT[] NOT NULL,
    calendar_id             TEXT NOT NULL DEFAULT 'primary',
    connected_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events_synced (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    google_event_id TEXT NOT NULL,
    google_etag     TEXT NOT NULL,
    title           TEXT NOT NULL,
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX events_synced_google ON events_synced(user_id, google_event_id);
CREATE INDEX events_synced_user_recent ON events_synced(user_id, start_time DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS events_synced;
DROP TABLE IF EXISTS user_google_credentials;

-- +goose StatementEnd
