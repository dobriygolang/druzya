-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00004 arena: matches, participants, editor rooms, custom lobbies,
--   anticheat signals
-- Consolidated from: 00004_arena_mock (arena parts), 00012_arena_2v2,
--   00037_custom_lobby, 00007_system_billing (anticheat only)
-- ============================================================

CREATE TABLE arena_matches (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id           UUID NOT NULL REFERENCES tasks(id),
    task_version      INT NOT NULL,
    section           TEXT NOT NULL,
    mode              TEXT NOT NULL,
    status            TEXT NOT NULL,
    winner_id         UUID REFERENCES users(id),
    winning_team_id   SMALLINT,
    started_at        TIMESTAMPTZ,
    finished_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT arena_matches_section_valid CHECK (section IN ('algorithms','sql','go','system_design','behavioral')),
    CONSTRAINT arena_matches_status_valid  CHECK (status IN ('searching','confirming','active','finished','cancelled')),
    CONSTRAINT arena_matches_mode_valid    CHECK (mode IN ('solo_1v1','duo_2v2','ranked','hardcore','cursed')),
    CONSTRAINT arena_matches_winning_team_valid
        CHECK (winning_team_id IS NULL OR winning_team_id IN (1, 2))
);
CREATE INDEX idx_arena_matches_status ON arena_matches(status);

CREATE TABLE arena_participants (
    match_id         UUID NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team             INT NOT NULL DEFAULT 0,
    elo_before       INT NOT NULL,
    elo_after        INT,
    suspicion_score  NUMERIC(4,2),
    solve_time_ms    BIGINT,
    submitted_at     TIMESTAMPTZ,
    PRIMARY KEY (match_id, user_id),
    CONSTRAINT arena_participants_team_valid CHECK (team IN (0, 1, 2))
);
CREATE INDEX idx_arena_participants_user       ON arena_participants(user_id);
CREATE INDEX idx_arena_participants_match_team ON arena_participants(match_id, team);

-- ─── editor rooms (collaborative editor) ────────────────────
CREATE TABLE editor_rooms (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL DEFAULT 'practice',
    task_id    UUID REFERENCES tasks(id),
    language   TEXT NOT NULL,
    is_frozen  BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE editor_participants (
    room_id    UUID NOT NULL REFERENCES editor_rooms(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, user_id),
    CONSTRAINT editor_role_valid CHECK (role IN ('owner','interviewer','participant','viewer'))
);

-- ─── custom lobbies ─────────────────────────────────────────
CREATE TABLE lobbies (
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
    CONSTRAINT lobbies_mode_valid        CHECK (mode IN ('1v1','2v2')),
    CONSTRAINT lobbies_visibility_valid  CHECK (visibility IN ('public','unlisted','private')),
    CONSTRAINT lobbies_status_valid      CHECK (status IN ('open','live','cancelled')),
    CONSTRAINT lobbies_max_members_valid CHECK (max_members BETWEEN 2 AND 4),
    CONSTRAINT lobbies_time_limit_valid  CHECK (time_limit_min BETWEEN 5 AND 180),
    CONSTRAINT lobbies_code_format       CHECK (code ~ '^[A-Z]{4}$')
);
CREATE INDEX idx_lobbies_public_list ON lobbies(visibility, status, created_at DESC);

CREATE TABLE lobby_members (
    lobby_id    UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    role        TEXT NOT NULL DEFAULT 'member',
    team        SMALLINT NOT NULL DEFAULT 1,
    PRIMARY KEY (lobby_id, user_id),
    CONSTRAINT lobby_members_role_valid CHECK (role IN ('owner','member')),
    CONSTRAINT lobby_members_team_valid CHECK (team IN (1,2))
);
CREATE INDEX idx_lobby_members_user ON lobby_members(user_id);

-- ─── anticheat signals (FK to arena_matches) ───────────────
CREATE TABLE anticheat_signals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_id    UUID REFERENCES arena_matches(id) ON DELETE SET NULL,
    type        TEXT NOT NULL,
    severity    TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT anticheat_severity_valid CHECK (severity IN ('low','medium','high'))
);
CREATE INDEX idx_anticheat_signals_user ON anticheat_signals(user_id, created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;
-- +goose StatementEnd
