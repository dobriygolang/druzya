-- 00035_hone_user_settings.sql — Active study mode (general/dev/ml/english/go).
--
-- Per-user UI preference for the Hone desktop cockpit. Decides which
-- track-tagged content surfaces on Today / Tasks / Reading and which
-- AI-tutor persona is preferred. Default 'general' = legacy all-in-one.
-- 'go' is a sub-mode of 'dev' (Sergey-style deep Go sessions).

-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS hone_user_settings (
    user_id      uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    active_track text        NOT NULL DEFAULT 'general'
        CHECK (active_track IN ('general','dev','ml','english','go')),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS hone_user_settings;
-- +goose StatementEnd
