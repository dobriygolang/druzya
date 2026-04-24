-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00005 daily + AI mock interviews + native AI sessions
-- Consolidated from: 00004_arena_mock (mock + native parts),
--   00006_daily_podcast (daily, calendars, autopsies)
-- ============================================================

-- ─── AI mock interview ─────────────────────────────────────
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
    -- running_summary: конденсат старых turns для sliding-window compaction
    -- (Phase 4). Фоновый воркер обновляет колонку, когда сессия переваливает
    -- COMPACTION_THRESHOLD сообщений. На hot-path SendMessage.generateReply
    -- собирает prompt = system + running_summary + last_N.
    running_summary TEXT NOT NULL DEFAULT '',
    started_at     TIMESTAMPTZ,
    finished_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mock_status_valid CHECK (status IN ('created','in_progress','finished','abandoned'))
);
CREATE INDEX idx_mock_sessions_user ON mock_sessions(user_id, created_at DESC);

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
CREATE INDEX idx_mock_messages_session ON mock_messages(session_id, created_at);

-- ─── native AI-assisted sessions ────────────────────────────
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
CREATE INDEX idx_native_sessions_user ON native_sessions(user_id);

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
CREATE INDEX idx_native_provenance_session ON native_provenance(session_id);

-- ─── daily kata streak ──────────────────────────────────────
CREATE TABLE daily_streaks (
    user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak   INT NOT NULL DEFAULT 0,
    longest_streak   INT NOT NULL DEFAULT 0,
    freeze_tokens    INT NOT NULL DEFAULT 0,
    last_kata_date   DATE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE daily_kata_history (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kata_date      DATE NOT NULL,
    task_id        UUID NOT NULL REFERENCES tasks(id),
    is_cursed      BOOLEAN NOT NULL DEFAULT FALSE,
    is_weekly_boss BOOLEAN NOT NULL DEFAULT FALSE,
    passed         BOOLEAN,
    freeze_used    BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at   TIMESTAMPTZ,
    PRIMARY KEY (user_id, kata_date)
);
CREATE INDEX idx_kata_history_user_date ON daily_kata_history(user_id, kata_date DESC);

-- ─── interview calendar + post-mortem autopsy ──────────────
CREATE TABLE interview_calendars (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id),
    role            TEXT NOT NULL,
    interview_date  DATE NOT NULL,
    current_level   TEXT,
    plan_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
    readiness_pct   INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_interview_calendars_user_date ON interview_calendars(user_id, interview_date DESC);

CREATE TABLE interview_autopsies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id),
    section         TEXT NOT NULL,
    outcome         TEXT NOT NULL,
    interview_date  DATE,
    questions_raw   TEXT,
    answers_raw     TEXT,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'processing',
    analysis_json   JSONB,
    share_slug      TEXT UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT autopsies_outcome_valid CHECK (outcome IN ('offer','rejection','pending')),
    CONSTRAINT autopsies_status_valid  CHECK (status IN ('processing','ready','failed'))
);
CREATE INDEX idx_autopsies_user ON interview_autopsies(user_id, created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;
-- +goose StatementEnd
