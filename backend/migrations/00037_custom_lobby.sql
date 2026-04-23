-- +goose Up
-- +goose StatementBegin
--
-- 00037 — Custom Lobby (WAVE-11): private/public match rooms.
--
-- A custom lobby is a private match room created by a user, joinable via:
--   1) the public list (visibility='public', browseable on /lobbies)
--   2) a direct invite link (/lobby/{id}, all visibilities)
--   3) a 4-letter A-Z code (regardless of visibility)
--
-- When the owner clicks "Start" or all slots are filled, the lobby transitions
-- from status='open' to status='live' and stores the resulting arena_match.id
-- in match_id. Members are then expected to navigate to /arena/match/{match_id}.
--
-- ANTI-FALLBACK: this table is the single source of truth for lobby state.
-- The frontend MUST NOT cache hardcoded room lists or invent placeholder
-- lobbies — the public-list query (visibility='public', status='open') is
-- the only way to discover a lobby that wasn't shared by code/link. This
-- migration intentionally enforces uniqueness on `code` so collisions surface
-- as 23505 instead of being silently re-keyed by the application.

CREATE TABLE IF NOT EXISTS lobbies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            CHAR(4) NOT NULL UNIQUE,
    owner_id        UUID NOT NULL REFERENCES users(id),
    mode            TEXT NOT NULL,
    section         TEXT NOT NULL,
    difficulty      TEXT NOT NULL,
    visibility      TEXT NOT NULL DEFAULT 'public',
    max_members     SMALLINT NOT NULL DEFAULT 2,
    ai_allowed      BOOLEAN NOT NULL DEFAULT FALSE,
    time_limit_min  SMALLINT NOT NULL DEFAULT 30,
    status          TEXT NOT NULL DEFAULT 'open',
    match_id        UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lobbies_mode_valid
        CHECK (mode IN ('1v1','2v2')),
    CONSTRAINT lobbies_visibility_valid
        CHECK (visibility IN ('public','unlisted','private')),
    CONSTRAINT lobbies_status_valid
        CHECK (status IN ('open','live','cancelled')),
    CONSTRAINT lobbies_max_members_valid
        CHECK (max_members BETWEEN 2 AND 4),
    CONSTRAINT lobbies_time_limit_valid
        CHECK (time_limit_min BETWEEN 5 AND 180),
    CONSTRAINT lobbies_code_format
        CHECK (code ~ '^[A-Z]{4}$')
);

CREATE TABLE IF NOT EXISTS lobby_members (
    lobby_id    UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    role        TEXT NOT NULL DEFAULT 'member',
    team        SMALLINT NOT NULL DEFAULT 1,
    PRIMARY KEY (lobby_id, user_id),
    CONSTRAINT lobby_members_role_valid
        CHECK (role IN ('owner','member')),
    CONSTRAINT lobby_members_team_valid
        CHECK (team IN (1,2))
);

-- Public-list query path: WHERE visibility='public' AND status='open' ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS idx_lobbies_public_list
    ON lobbies(visibility, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lobby_members_user
    ON lobby_members(user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_lobby_members_user;
DROP INDEX IF EXISTS idx_lobbies_public_list;
DROP TABLE IF EXISTS lobby_members;
DROP TABLE IF EXISTS lobbies;
-- +goose StatementEnd
