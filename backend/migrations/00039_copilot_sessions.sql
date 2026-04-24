-- +goose Up
-- +goose StatementBegin

-- copilot_sessions — a grouping sentinel for the "Start interview" flow.
-- All conversations created between StartSession and EndSession attach
-- via copilot_conversations.session_id.
CREATE TABLE copilot_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ,
    -- Some turns inside the session used BYOK keys. When TRUE the
    -- server-side analyzer skips the session entirely — the desktop
    -- client runs analysis locally through the user's key. We track
    -- it as a flag (not a count) because one BYOK turn poisons the
    -- whole session from a "nothing-on-our-server" perspective.
    byok_only        BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT copilot_sessions_kind_valid
        CHECK (kind IN ('interview','work','casual'))
);

CREATE INDEX IF NOT EXISTS idx_copilot_sessions_user_started
    ON copilot_sessions(user_id, started_at DESC);

-- Index for the "live session" lookup — at most one per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_copilot_sessions_live
    ON copilot_sessions(user_id)
    WHERE finished_at IS NULL;

ALTER TABLE copilot_conversations
    ADD COLUMN session_id UUID REFERENCES copilot_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_copilot_conversations_session
    ON copilot_conversations(session_id)
    WHERE session_id IS NOT NULL;

-- copilot_session_reports — one row per session, populated by the
-- analyzer. status progresses pending → running → ready | failed.
-- Report content is Markdown + JSON-encoded scores; we keep the shape
-- flat so sqlc doesn't need nested structs.
CREATE TABLE copilot_session_reports (
    session_id        UUID PRIMARY KEY REFERENCES copilot_sessions(id) ON DELETE CASCADE,
    status            TEXT NOT NULL DEFAULT 'pending',
    overall_score     INT NOT NULL DEFAULT 0,
    section_scores    JSONB NOT NULL DEFAULT '{}'::JSONB,   -- {"algorithms": 78, ...}
    weaknesses        JSONB NOT NULL DEFAULT '[]'::JSONB,   -- ["SQL оконные функции", ...]
    recommendations   JSONB NOT NULL DEFAULT '[]'::JSONB,
    links             JSONB NOT NULL DEFAULT '[]'::JSONB,   -- [{"label":"...", "url":"..."}]
    report_markdown   TEXT NOT NULL DEFAULT '',
    -- Web URL where the Druzya frontend renders the full report.
    -- Constructed from a template on the backend; the client opens it
    -- via shell.openExternal.
    report_url        TEXT NOT NULL DEFAULT '',
    error_message     TEXT NOT NULL DEFAULT '',
    started_at        TIMESTAMPTZ,
    finished_at       TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT copilot_session_reports_status_valid
        CHECK (status IN ('pending','running','ready','failed'))
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS copilot_session_reports;

DROP INDEX IF EXISTS idx_copilot_conversations_session;
ALTER TABLE copilot_conversations DROP COLUMN IF EXISTS session_id;

DROP INDEX IF EXISTS idx_copilot_sessions_live;
DROP INDEX IF EXISTS idx_copilot_sessions_user_started;
DROP TABLE IF EXISTS copilot_sessions;
-- +goose StatementEnd
