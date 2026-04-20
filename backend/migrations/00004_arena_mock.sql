-- +goose Up
-- +goose StatementBegin
CREATE TABLE arena_matches (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id       UUID NOT NULL REFERENCES tasks(id),
    task_version  INT NOT NULL,
    section       TEXT NOT NULL,
    mode          TEXT NOT NULL,
    status        TEXT NOT NULL,
    winner_id     UUID REFERENCES users(id),
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT arena_matches_section_valid CHECK (section IN ('algorithms','sql','go','system_design','behavioral')),
    CONSTRAINT arena_matches_status_valid CHECK (status IN ('searching','confirming','active','finished','cancelled')),
    CONSTRAINT arena_matches_mode_valid CHECK (mode IN ('solo_1v1','duo_2v2','ranked','hardcore','cursed'))
);

CREATE TABLE arena_participants (
    match_id         UUID NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team             INT NOT NULL DEFAULT 0,
    elo_before       INT NOT NULL,
    elo_after        INT,
    suspicion_score  NUMERIC(4,2),
    solve_time_ms    BIGINT,
    submitted_at     TIMESTAMPTZ,
    PRIMARY KEY (match_id, user_id)
);

CREATE TABLE mock_sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id     UUID REFERENCES companies(id),
    task_id        UUID REFERENCES tasks(id),
    section        TEXT NOT NULL,
    difficulty     TEXT NOT NULL,
    status         TEXT NOT NULL,
    duration_min   INT NOT NULL DEFAULT 45,
    voice_mode     BOOLEAN NOT NULL DEFAULT FALSE,
    paired_user_id UUID REFERENCES users(id),
    llm_model      TEXT,
    stress_profile JSONB,
    ai_report      JSONB,
    replay_url     TEXT,
    started_at     TIMESTAMPTZ,
    finished_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mock_status_valid CHECK (status IN ('created','in_progress','finished','abandoned'))
);

CREATE TABLE mock_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES mock_sessions(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    code_snapshot   TEXT,
    stress_snapshot JSONB,
    tokens_used     INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mock_messages_role_valid CHECK (role IN ('system','user','assistant'))
);

CREATE TABLE native_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id     UUID REFERENCES tasks(id),
    section     TEXT NOT NULL,
    difficulty  TEXT NOT NULL,
    llm_model   TEXT,
    context_score      INT NOT NULL DEFAULT 0,
    verification_score INT NOT NULL DEFAULT 0,
    judgment_score     INT NOT NULL DEFAULT 0,
    delivery_score     INT NOT NULL DEFAULT 0,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE native_provenance (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES native_sessions(id) ON DELETE CASCADE,
    parent_id   UUID REFERENCES native_provenance(id),
    kind        TEXT NOT NULL,
    snippet     TEXT NOT NULL,
    ai_prompt   TEXT,
    has_hallucination_trap BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT native_provenance_kind_valid CHECK (kind IN ('ai_generated','human_written','ai_revised_by_human','ai_rejected'))
);

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

CREATE INDEX idx_arena_matches_status ON arena_matches(status);
CREATE INDEX idx_arena_participants_user ON arena_participants(user_id);
CREATE INDEX idx_mock_sessions_user ON mock_sessions(user_id, created_at DESC);
CREATE INDEX idx_mock_messages_session ON mock_messages(session_id, created_at);
CREATE INDEX idx_native_sessions_user ON native_sessions(user_id);
CREATE INDEX idx_native_provenance_session ON native_provenance(session_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS editor_participants;
DROP TABLE IF EXISTS editor_rooms;
DROP TABLE IF EXISTS native_provenance;
DROP TABLE IF EXISTS native_sessions;
DROP TABLE IF EXISTS mock_messages;
DROP TABLE IF EXISTS mock_sessions;
DROP TABLE IF EXISTS arena_participants;
DROP TABLE IF EXISTS arena_matches;
-- +goose StatementEnd
