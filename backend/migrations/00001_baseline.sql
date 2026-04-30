-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00001 baseline (schema_v2)
-- ============================================================
-- Single consolidated baseline. Containers are dropped between
-- versions, so we compress the schema instead of carrying historical
-- ALTER chains.
--
-- Audit decisions applied (see hone-iridescent-sunset.md):
--   * email + password_hash + ai_default_model removed from users
--     (auth = OAuth-only via Yandex + Telegram, no recovery)
--   * notification_preferences merged into notification_prefs
--   * notifications_log dropped (event-log nobody reads)
--   * boosty_level + started_at dropped from subscriptions
--   * arena_participants.solve_time_ms dropped
--   * hone_cue_sessions merged into hone_notes via `kind` enum
--   * hone_notes.archived_at dropped (hard delete only)
--   * note_yjs_updates.origin_device_id dropped (dedup via seq)
--   * devices.app_version dropped
--   * org_* tables dropped (enterprise flow not shipping)
--   * season_reward_claims + seasons + native_* + interview_*
--     + achievements + cohort_* + boosty_accounts dropped
--   * support_tickets contact_kind: telegram-only
--   * profiles.{xp, level} → moved to user_xp + xp_events log
--   * embedding_model text → embedding_model_id FK
-- New for v2: hone_tasks + hone_task_comments + embedding_models +
--   user_xp + xp_events + codex_articles.quiz_question/answer.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Phase IX: pgvector — typed vector columns + native cosine distance
-- operator. До перехода на vector queries на read-side остаются
-- параллельные real[] embeddings + Go-cosine; при активации scale
-- (>10k активных users) readers свитчатся на `<->` оператор и индекс
-- IVFFlat / HNSW. См. ниже комментарии в hone_notes / coach_episodes.
CREATE EXTENSION IF NOT EXISTS "vector";

-- =============================================================
-- AUTH & IDENTITY
-- =============================================================

CREATE TABLE users (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username                TEXT NOT NULL UNIQUE,
    role                    TEXT NOT NULL DEFAULT 'user',
    locale                  TEXT NOT NULL DEFAULT 'ru',
    display_name            TEXT,
    avatar_url              TEXT NOT NULL DEFAULT '',
    ai_insight_model        TEXT,
    ai_vacancies_model      TEXT,
    onboarding_completed_at TIMESTAMPTZ,
    focus_class             TEXT NOT NULL DEFAULT '',
    storage_quota_bytes     BIGINT NOT NULL DEFAULT 1073741824,
    storage_used_bytes      BIGINT NOT NULL DEFAULT 0,
    storage_tier            TEXT NOT NULL DEFAULT 'free',
    storage_recomputed_at   TIMESTAMPTZ,
    vault_kdf_salt          BYTEA,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_role_valid CHECK (role IN ('user','interviewer','admin')),
    CONSTRAINT users_focus_class_valid
        CHECK (focus_class IN ('', 'algo', 'backend', 'system', 'concurrency', 'ds')),
    CONSTRAINT users_storage_tier_valid CHECK (storage_tier IN ('free','pro','pro_plus'))
);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_storage_tier_paid ON users(storage_tier) WHERE storage_tier <> 'free';

CREATE TABLE oauth_accounts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider           TEXT NOT NULL,
    provider_user_id   TEXT NOT NULL,
    access_token_enc   BYTEA,
    refresh_token_enc  BYTEA,
    token_expires_at   TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT oauth_provider_valid CHECK (provider IN ('yandex','telegram')),
    UNIQUE (provider, provider_user_id)
);
CREATE INDEX idx_oauth_user ON oauth_accounts(user_id);

CREATE TABLE user_bans (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason        TEXT NOT NULL,
    issued_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ,
    lifted_at     TIMESTAMPTZ,
    lifted_by     UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_user_bans_user ON user_bans(user_id, issued_at DESC);
CREATE UNIQUE INDEX uq_user_bans_active ON user_bans(user_id) WHERE lifted_at IS NULL;

CREATE TABLE user_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason          TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending',
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_reports_status_valid CHECK (status IN ('pending','resolved','dismissed'))
);
CREATE INDEX idx_user_reports_status ON user_reports(status, created_at DESC);
CREATE INDEX idx_user_reports_target ON user_reports(reported_id, created_at DESC);

CREATE TABLE incidents (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at         TIMESTAMPTZ NOT NULL,
    ended_at           TIMESTAMPTZ,
    severity           TEXT NOT NULL,
    title              TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    affected_services  TEXT[] NOT NULL DEFAULT '{}'::text[],
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT incidents_severity_valid CHECK (severity IN ('minor','major','critical'))
);
CREATE INDEX idx_incidents_started ON incidents(started_at DESC);

-- =============================================================
-- TELEGRAM LINK
-- =============================================================

CREATE TABLE tg_user_link (
    user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    chat_id        BIGINT NOT NULL UNIQUE,
    tg_username    TEXT,
    linked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    locale         TEXT NOT NULL DEFAULT 'ru',
    push_local_hh  INT  NOT NULL DEFAULT 9 CHECK (push_local_hh BETWEEN 0 AND 23),
    push_tz        TEXT NOT NULL DEFAULT 'Europe/Moscow',
    paused_until   TIMESTAMPTZ,
    last_seen_at   TIMESTAMPTZ
);
CREATE INDEX idx_tg_user_link_chat ON tg_user_link(chat_id);

CREATE TABLE tg_link_tokens (
    token       TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);
CREATE INDEX idx_tg_link_tokens_user ON tg_link_tokens(user_id);

-- =============================================================
-- PROFILES & PROGRESSION (xp/level live in user_xp + xp_events)
-- =============================================================

CREATE TABLE profiles (
    user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    char_class          TEXT NOT NULL DEFAULT 'novice',
    title               TEXT,
    avatar_frame        TEXT,
    career_stage        TEXT NOT NULL DEFAULT 'junior',
    intellect           INT NOT NULL DEFAULT 0,
    strength            INT NOT NULL DEFAULT 0,
    dexterity           INT NOT NULL DEFAULT 0,
    will                INT NOT NULL DEFAULT 0,
    is_mentor           BOOL   NOT NULL DEFAULT FALSE,
    mentor_hourly_rate  INT    NOT NULL DEFAULT 0,
    mentor_bio          TEXT   NOT NULL DEFAULT '',
    mentor_languages    TEXT[] NOT NULL DEFAULT '{}',
    mentor_verified     BOOL   NOT NULL DEFAULT FALSE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT char_class_valid CHECK (char_class IN ('novice','algorithmist','dba','backend_dev','architect','communicator','ascendant')),
    CONSTRAINT career_stage_valid CHECK (career_stage IN ('junior','middle','senior','staff','principal'))
);
CREATE INDEX idx_profiles_is_mentor ON profiles(is_mentor) WHERE is_mentor;

CREATE TABLE user_xp (
    user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_xp     BIGINT NOT NULL DEFAULT 0,
    level        INT    NOT NULL DEFAULT 1,
    last_xp_at   TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE xp_events (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount      INT NOT NULL,
    source      TEXT NOT NULL,
    source_id   UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT xp_events_source_valid
        CHECK (source IN ('task','arena','kata','podcast','mock','quiz','review','custom'))
);
CREATE INDEX idx_xp_events_user_created ON xp_events(user_id, created_at DESC);

CREATE TABLE ratings (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section        TEXT NOT NULL,
    elo            INT NOT NULL DEFAULT 1000,
    matches_count  INT NOT NULL DEFAULT 0,
    last_match_at  TIMESTAMPTZ,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, section),
    CONSTRAINT ratings_section_valid CHECK (section IN ('algorithms','sql','go','system_design','behavioral'))
);
CREATE INDEX idx_ratings_section_elo ON ratings(section, elo DESC);

CREATE TABLE skill_nodes (
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_key     TEXT NOT NULL,
    progress     INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    unlocked_at  TIMESTAMPTZ,
    decayed_at   TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, node_key)
);
CREATE INDEX idx_skill_nodes_user ON skill_nodes(user_id);

CREATE TABLE atlas_nodes (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    section      TEXT NOT NULL,
    kind         TEXT NOT NULL,
    cluster      TEXT NOT NULL DEFAULT '',
    description  TEXT NOT NULL DEFAULT '',
    total_count  INT  NOT NULL DEFAULT 0,
    pos_x        INT,
    pos_y        INT,
    sort_order   INT  NOT NULL DEFAULT 0,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT atlas_nodes_kind_valid CHECK (kind IN ('hub','keystone','notable','small')),
    CONSTRAINT atlas_nodes_total_nonneg CHECK (total_count >= 0)
);
CREATE INDEX idx_atlas_nodes_active_section ON atlas_nodes(section) WHERE is_active = TRUE;
CREATE INDEX idx_atlas_nodes_active_cluster ON atlas_nodes(cluster) WHERE is_active = TRUE;

CREATE TABLE atlas_edges (
    id        BIGSERIAL PRIMARY KEY,
    from_id   TEXT NOT NULL REFERENCES atlas_nodes(id) ON DELETE CASCADE,
    to_id     TEXT NOT NULL REFERENCES atlas_nodes(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL DEFAULT 'prereq',
    UNIQUE (from_id, to_id),
    CONSTRAINT atlas_edges_no_self CHECK (from_id <> to_id),
    CONSTRAINT atlas_edges_kind_valid CHECK (kind IN ('prereq','suggested','crosslink'))
);
CREATE INDEX idx_atlas_edges_to ON atlas_edges(to_id);

INSERT INTO atlas_nodes (id, title, section, kind, cluster, description, total_count, sort_order) VALUES
    ('class_core',     'Ядро класса',                'algorithms',    'hub',      'algorithms',    'Стартовая точка атласа',                  1,   0),
    ('algo_basics',    'Алгоритмы: основы',          'algorithms',    'small',    'algorithms',    'Массивы, строки, хеш-таблицы',            23, 10),
    ('algo_graphs',    'Алгоритмы: графы',           'algorithms',    'small',    'algorithms',    'DFS/BFS, топосорт, Дейкстра',             18, 11),
    ('algo_dp',        'Алгоритмы: DP',              'algorithms',    'notable',  'algorithms',    'Динамическое программирование',           30, 12),
    ('sql_basics',     'SQL: основы',                'sql',           'small',    'sql',           'JOIN, GROUP BY, подзапросы',              14, 20),
    ('sql_perf',       'SQL: производительность',    'sql',           'notable',  'sql',           'Индексы, EXPLAIN, денормализация',         9, 21),
    ('go_concurrency', 'Go: concurrency',            'go',            'notable',  'go',            'Горутины, каналы, контексты',             16, 31),
    ('go_idioms',      'Go: идиомы',                 'go',            'small',    'go',            'Интерфейсы, ошибки, дженерики',           12, 30),
    ('sd_basics',      'System Design: основы',      'system_design', 'small',    'system_design', 'CAP, кэши, очереди',                       8, 40),
    ('sd_scale',       'System Design: масштаб',     'system_design', 'keystone', 'system_design', 'Шардирование, репликация, consistency',    6, 41),
    ('beh_star',       'Behavioral: STAR',           'behavioral',    'small',    'behavioral',    'Структура ответов на вопросы',            10, 50)
ON CONFLICT (id) DO NOTHING;

INSERT INTO atlas_edges (from_id, to_id) VALUES
    ('class_core', 'algo_basics'), ('class_core', 'sql_basics'), ('class_core', 'go_idioms'),
    ('class_core', 'beh_star'),    ('class_core', 'sd_basics'),
    ('algo_basics', 'algo_graphs'), ('algo_basics', 'algo_dp'),
    ('sql_basics', 'sql_perf'), ('go_idioms', 'go_concurrency'), ('sd_basics', 'sd_scale')
ON CONFLICT (from_id, to_id) DO NOTHING;

CREATE TABLE elo_snapshots_daily (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section        TEXT NOT NULL,
    snapshot_date  DATE NOT NULL,
    elo            INT  NOT NULL,
    matches_played INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, section, snapshot_date),
    CONSTRAINT elo_snapshots_section_valid
        CHECK (section IN ('algorithms','sql','go','system_design','behavioral'))
);
CREATE INDEX idx_elo_snapshots_user_date ON elo_snapshots_daily (user_id, snapshot_date DESC);

CREATE TABLE weekly_share_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_iso    TEXT NOT NULL,
    token       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    views_count INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_weekly_share_tokens_token     ON weekly_share_tokens (token);
CREATE INDEX idx_weekly_share_tokens_user_week ON weekly_share_tokens (user_id, week_iso);

CREATE TABLE mentor_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentee_id       UUID NOT NULL REFERENCES users(id),
    mentor_id       UUID NOT NULL REFERENCES users(id),
    slot_at         TIMESTAMPTZ NOT NULL,
    duration_min    INT NOT NULL DEFAULT 60,
    status          TEXT NOT NULL DEFAULT 'requested',
    escrow_state    TEXT NOT NULL DEFAULT 'disabled',
    price_cents     INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mentor_sessions_status_valid
        CHECK (status IN ('requested','accepted','completed','disputed','cancelled')),
    CONSTRAINT mentor_sessions_escrow_valid
        CHECK (escrow_state IN ('disabled','held','released','refunded')),
    CONSTRAINT mentor_sessions_distinct_parties CHECK (mentee_id <> mentor_id)
);
CREATE INDEX idx_mentor_sessions_mentor ON mentor_sessions(mentor_id, slot_at DESC);
CREATE INDEX idx_mentor_sessions_mentee ON mentor_sessions(mentee_id, slot_at DESC);

-- =============================================================
-- CONTENT (companies + tasks; full task seed in 00002_content_seed.sql)
-- =============================================================

CREATE TABLE companies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    difficulty          TEXT NOT NULL DEFAULT 'normal',
    min_level_required  INT NOT NULL DEFAULT 0,
    sections            TEXT[] NOT NULL DEFAULT '{}',
    logo_url            TEXT,
    description         TEXT NOT NULL DEFAULT '',
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order          INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT companies_difficulty_valid CHECK (difficulty IN ('normal','hard','boss'))
);
CREATE INDEX idx_companies_active_sort ON companies(active, sort_order) WHERE active;

CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,
    title_ru        TEXT NOT NULL,
    title_en        TEXT NOT NULL,
    description_ru  TEXT NOT NULL,
    description_en  TEXT NOT NULL,
    difficulty      TEXT NOT NULL,
    section         TEXT NOT NULL,
    time_limit_sec  INT NOT NULL DEFAULT 60,
    memory_limit_mb INT NOT NULL DEFAULT 256,
    solution_hint   TEXT,
    version         INT NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    avg_rating      NUMERIC(3,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tasks_difficulty_valid CHECK (difficulty IN ('easy','medium','hard')),
    CONSTRAINT tasks_section_valid CHECK (section IN ('algorithms','sql','go','system_design','behavioral'))
);
CREATE INDEX idx_tasks_section_diff ON tasks(section, difficulty) WHERE is_active;

CREATE TABLE test_cases (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    input            TEXT NOT NULL,
    expected_output  TEXT NOT NULL,
    is_hidden        BOOLEAN NOT NULL DEFAULT FALSE,
    order_num        INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_test_cases_task ON test_cases(task_id);

CREATE TABLE task_templates (
    task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    language      TEXT NOT NULL,
    starter_code  TEXT NOT NULL,
    PRIMARY KEY (task_id, language),
    CONSTRAINT task_templates_lang_valid CHECK (language IN ('go','python','javascript','typescript','sql'))
);

CREATE TABLE follow_up_questions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    question_ru  TEXT NOT NULL,
    question_en  TEXT NOT NULL,
    answer_hint  TEXT,
    order_num    INT NOT NULL DEFAULT 0
);

CREATE TABLE task_ratings (
    task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stars      INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, user_id)
);

INSERT INTO companies(slug, name, difficulty, min_level_required, sections) VALUES
  ('avito',  'Avito',  'normal', 0,  ARRAY['algorithms','sql','go','system_design','behavioral']),
  ('vk',     'VK',     'normal', 0,  ARRAY['algorithms','sql','go','system_design','behavioral']),
  ('t-bank', 'T-Bank', 'hard',   12, ARRAY['algorithms','sql','go','system_design','behavioral']),
  ('ozon',   'Ozon',   'hard',   10, ARRAY['algorithms','sql','go','system_design','behavioral']),
  ('yandex', 'Yandex', 'boss',   30, ARRAY['algorithms','sql','go','system_design','behavioral'])
ON CONFLICT (slug) DO NOTHING;

-- =============================================================
-- ARENA
-- =============================================================

CREATE TABLE arena_matches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL REFERENCES tasks(id),
    task_version    INT NOT NULL,
    section         TEXT NOT NULL,
    mode            TEXT NOT NULL,
    status          TEXT NOT NULL,
    winner_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    winning_team_id SMALLINT,
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT arena_matches_section_valid CHECK (section IN ('algorithms','sql','go','system_design','behavioral')),
    CONSTRAINT arena_matches_mode_valid    CHECK (mode IN ('1v1','2v2','solo','custom')),
    CONSTRAINT arena_matches_status_valid  CHECK (status IN ('queued','in_progress','finished','abandoned')),
    CONSTRAINT arena_matches_winning_team_valid CHECK (winning_team_id IS NULL OR winning_team_id IN (1,2))
);
CREATE INDEX idx_arena_matches_status          ON arena_matches(status);
CREATE INDEX idx_arena_matches_status_finished ON arena_matches(status, finished_at DESC) WHERE status = 'finished';
CREATE INDEX idx_arena_matches_winner_finished ON arena_matches(winner_id, finished_at DESC) WHERE winner_id IS NOT NULL;

CREATE TABLE arena_participants (
    match_id         UUID NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id),
    team             INT NOT NULL DEFAULT 0,
    elo_before       INT NOT NULL,
    elo_after        INT,
    suspicion_score  NUMERIC(4,2),
    submitted_at     TIMESTAMPTZ,
    PRIMARY KEY (match_id, user_id),
    CONSTRAINT arena_participants_team_valid CHECK (team IN (0,1,2))
);
CREATE INDEX idx_arena_participants_user ON arena_participants(user_id);
CREATE INDEX idx_arena_participants_match_team ON arena_participants(match_id, team);

CREATE TABLE anticheat_signals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_id    UUID REFERENCES arena_matches(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    severity    TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT anticheat_signals_severity_valid CHECK (severity IN ('low','medium','high'))
);
CREATE INDEX idx_anticheat_signals_user ON anticheat_signals(user_id, created_at DESC);

-- =============================================================
-- DAILY KATA + AI MOCK SESSIONS
-- =============================================================

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

CREATE TABLE mock_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id      UUID REFERENCES companies(id),
    task_id         UUID REFERENCES tasks(id),
    section         TEXT NOT NULL,
    difficulty      TEXT NOT NULL,
    status          TEXT NOT NULL,
    duration_min    INT NOT NULL DEFAULT 45,
    voice_mode      BOOLEAN NOT NULL DEFAULT FALSE,
    paired_user_id  UUID REFERENCES users(id),
    llm_model       TEXT,
    stress_profile  JSONB,
    ai_report       JSONB,
    ai_assist       BOOLEAN NOT NULL DEFAULT FALSE,
    running_summary TEXT NOT NULL DEFAULT '',
    -- Phase II context-preservation: см. copilot_conversations.summary_model.
    summary_model   TEXT NOT NULL DEFAULT '',
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mock_status_valid CHECK (status IN ('created','in_progress','finished','abandoned'))
);
CREATE INDEX idx_mock_sessions_user ON mock_sessions(user_id, created_at DESC);
CREATE INDEX idx_mock_sessions_user_finished ON mock_sessions(user_id, finished_at DESC) WHERE finished_at IS NOT NULL;

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

-- =============================================================
-- SLOTS / BOOKINGS / REVIEWS
-- =============================================================

CREATE TABLE slots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interviewer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    starts_at       TIMESTAMPTZ NOT NULL,
    duration_min    INT NOT NULL,
    section         TEXT NOT NULL,
    difficulty      TEXT,
    language        TEXT NOT NULL DEFAULT 'ru',
    price_rub       INT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'available',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    meet_url        TEXT,
    CONSTRAINT slots_section_valid CHECK (section IN ('algorithms','sql','go','system_design','behavioral')),
    CONSTRAINT slots_status_valid  CHECK (status IN ('available','booked','completed','cancelled','no_show'))
);
CREATE INDEX idx_slots_status_starts ON slots(status, starts_at);

CREATE TABLE bookings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id       UUID NOT NULL UNIQUE REFERENCES slots(id) ON DELETE CASCADE,
    candidate_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meet_url      TEXT,
    status        TEXT NOT NULL DEFAULT 'confirmed',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_candidate ON bookings(candidate_id);

CREATE TABLE reviews (
    booking_id     UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    direction      TEXT NOT NULL DEFAULT 'candidate_to_interviewer',
    reviewer_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating         INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    feedback       TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (booking_id, direction),
    CONSTRAINT reviews_direction_valid
        CHECK (direction IN ('candidate_to_interviewer','interviewer_to_candidate'))
);
CREATE INDEX idx_reviews_subject ON reviews(subject_id, created_at DESC);

CREATE TABLE interviewer_applications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    motivation    TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'pending',
    reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at   TIMESTAMPTZ,
    decision_note TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT interviewer_applications_status_valid
        CHECK (status IN ('pending','approved','rejected'))
);
CREATE UNIQUE INDEX interviewer_applications_one_pending
    ON interviewer_applications(user_id) WHERE status = 'pending';
CREATE INDEX interviewer_applications_status_created
    ON interviewer_applications(status, created_at DESC);

-- =============================================================
-- BILLING & SUBSCRIPTIONS
-- =============================================================

CREATE TABLE subscriptions (
    user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan                 TEXT NOT NULL DEFAULT 'free',
    status               TEXT NOT NULL DEFAULT 'active',
    provider             TEXT,
    provider_sub_id      TEXT,
    current_period_end   TIMESTAMPTZ,
    grace_until          TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_plan_valid     CHECK (plan IN ('free','pro','max')),
    CONSTRAINT subscriptions_provider_valid CHECK (provider IS NULL OR provider IN ('yookassa','tbank','admin'))
);
CREATE UNIQUE INDEX idx_subscriptions_provider_sub_id
    ON subscriptions (provider, provider_sub_id) WHERE provider_sub_id IS NOT NULL;
CREATE INDEX idx_subscriptions_plan_active
    ON subscriptions (plan) WHERE status = 'active';

CREATE TABLE provider_links (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider       TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    external_tier  TEXT,
    verified_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, provider),
    CONSTRAINT provider_links_provider_valid CHECK (provider IN ('yookassa','tbank'))
);
CREATE UNIQUE INDEX idx_provider_links_external ON provider_links (provider, external_id);

CREATE TABLE ai_credits (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance     INT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- DYNAMIC CONFIG (admin runtime knobs)
-- =============================================================

CREATE TABLE dynamic_config (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    type        TEXT NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID REFERENCES users(id),
    CONSTRAINT dynconfig_type_valid CHECK (type IN ('int','float','string','bool','json'))
);

INSERT INTO dynamic_config(key, value, type, description) VALUES
  ('arena_workers_count',          to_jsonb(4),     'int',   'Число воркеров матчмейкинга'),
  ('arena_anticheat_threshold',    to_jsonb(70),    'int',   'Порог suspicion score'),
  ('arena_match_confirm_sec',      to_jsonb(10),    'int',   'Окно подтверждения матча (сек)'),
  ('ai_max_concurrent_sessions',   to_jsonb(100),   'int',   'Максимум параллельных AI мок сессий'),
  ('ai_stress_pause_threshold_ms', to_jsonb(120000),'int',   'Порог паузы для наводящего вопроса'),
  ('elo_k_factor_new',             to_jsonb(32),    'int',   'K-фактор ELO для новичков'),
  ('elo_k_factor_veteran',         to_jsonb(16),    'int',   'K-фактор ELO для ветеранов'),
  ('xp_arena_win',                 to_jsonb(120),   'int',   'XP за победу в арене'),
  ('xp_arena_loss',                to_jsonb(20),    'int',   'XP за поражение в арене'),
  ('xp_mock_complete',             to_jsonb(80),    'int',   'XP за завершение AI мока'),
  ('xp_kata_daily',                to_jsonb(30),    'int',   'Базовый XP за Daily Kata'),
  ('xp_kata_cursed_multiplier',    to_jsonb(3),     'int',   'Множитель XP за проклятую Kata'),
  ('xp_task_algo',                 to_jsonb(20),    'int',   'XP за algo-task в TaskBoard'),
  ('xp_task_sysdesign',            to_jsonb(30),    'int',   'XP за sysdesign-task в TaskBoard'),
  ('xp_task_quiz',                 to_jsonb(10),    'int',   'XP за quiz-task в TaskBoard'),
  ('xp_task_custom',               to_jsonb(5),     'int',   'XP за custom-task в TaskBoard'),
  ('skill_decay_days',             to_jsonb(7),     'int',   'Дней без практики до начала деградации'),
  ('skill_decay_rate_pct',         to_jsonb(2),     'int',   'Процент деградации в день'),
  ('voice_mode_enabled',           to_jsonb(false), 'bool',  'Включён ли голосовой мок режим'),
  ('llm_default_free_model',       to_jsonb('openai/gpt-4o-mini'::text), 'string', 'Дефолтная LLM для free'),
  ('llm_default_paid_model',       to_jsonb('openai/gpt-4o'::text),      'string', 'Дефолтная LLM для premium'),
  ('copilot_plans', '{
    "default_model_id": "druz9/turbo",
    "order": ["free", "pro", "max"],
    "plans": {
      "free": {
        "display_name": "Free",
        "price_label": "Бесплатно",
        "tagline": "Для знакомства с продуктом",
        "bullets": ["20 запросов в день", "Только Турбо-цепочка", "Только macOS"],
        "cta_label": "Текущий план",
        "requests_cap": 20,
        "models_allowed": ["druz9/turbo"]
      },
      "pro": {
        "display_name": "Pro",
        "price_label": "499 ₽/мес",
        "tagline": "Для ежедневной работы",
        "bullets": ["200 запросов в день", "Расширенные модели", "История с облачной синхронизацией"],
        "cta_label": "Оформить подписку",
        "requests_cap": 200,
        "models_allowed": []
      },
      "max": {
        "display_name": "Max",
        "price_label": "1490 ₽/мес",
        "tagline": "Для интенсивной работы",
        "bullets": ["Безлимитные запросы", "Все модели", "Приоритетная поддержка"],
        "cta_label": "Оформить подписку",
        "requests_cap": -1,
        "models_allowed": []
      }
    }
  }'::jsonb, 'json', 'Copilot plan names, quotas, paywall copy and model allow-lists'),
  ('hone_taskboard_todo_cap',      to_jsonb(7),     'int',   'Максимум in-todo тасок на юзера'),
  ('hone_taskboard_ttl_days',      to_jsonb(14),    'int',   'TTL дней до auto-dismiss in-todo тасок')
ON CONFLICT (key) DO NOTHING;

-- =============================================================
-- NOTIFY (single prefs table; legacy notification_preferences gone;
-- legacy notifications_log dropped)
-- =============================================================

CREATE TABLE notification_prefs (
    user_id                       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    telegram_chat_id              TEXT,
    channel_enabled               JSONB NOT NULL DEFAULT '{"telegram":true,"in_app":true}'::jsonb,
    weekly_report_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    skill_decay_warnings_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    silence_until                 TIMESTAMPTZ,
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_notification_prefs_chat_id_unique
    ON notification_prefs(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
CREATE INDEX idx_notification_prefs_weekly_enabled
    ON notification_prefs(weekly_report_enabled) WHERE weekly_report_enabled;

CREATE TABLE user_notifications (
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
CREATE INDEX idx_un_user_created ON user_notifications (user_id, created_at DESC);
CREATE INDEX idx_un_user_unread
    ON user_notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE onboarding_progress (
    user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    step         INT NOT NULL DEFAULT 0,
    answers      JSONB,
    completed_at TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- SUPPORT (telegram-only contact)
-- =============================================================

CREATE TABLE support_tickets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    contact_kind    TEXT NOT NULL CHECK (contact_kind IN ('telegram')),
    contact_value   TEXT NOT NULL,
    subject         TEXT NOT NULL DEFAULT '',
    message         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','in_progress','resolved','closed')),
    internal_note   TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);
CREATE INDEX idx_support_tickets_status_created ON support_tickets(status, created_at DESC);
CREATE INDEX idx_support_tickets_user           ON support_tickets(user_id) WHERE user_id IS NOT NULL;

-- =============================================================
-- FRIENDSHIPS
-- =============================================================

CREATE TABLE friendships (
    id            BIGSERIAL PRIMARY KEY,
    requester_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted','blocked')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at   TIMESTAMPTZ,
    CHECK (requester_id <> addressee_id),
    UNIQUE (requester_id, addressee_id)
);
CREATE INDEX idx_friendships_addr_status ON friendships (addressee_id, status);
CREATE INDEX idx_friendships_req_status  ON friendships (requester_id, status);

CREATE TABLE friend_codes (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL
);

-- =============================================================
-- SAVED VACANCIES
-- =============================================================

CREATE TABLE saved_vacancies (
    id             BIGSERIAL PRIMARY KEY,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source         TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    snapshot_json  JSONB NOT NULL,
    status         TEXT NOT NULL DEFAULT 'saved'
                     CHECK (status IN ('saved','applied','interviewing','rejected','offer')),
    notes          TEXT,
    saved_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT saved_vacancies_user_source_extid_key UNIQUE (user_id, source, external_id)
);
CREATE INDEX idx_saved_vacancies_user             ON saved_vacancies (user_id, status);
CREATE INDEX idx_saved_vacancies_user_source_extid ON saved_vacancies (user_id, source, external_id);

-- =============================================================
-- PODCASTS
-- =============================================================

CREATE TABLE podcast_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#6c7af0',
    sort_order  INT  NOT NULL DEFAULT 100,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO podcast_categories (slug, name, color, sort_order) VALUES
    ('system-design', 'System Design', '#7c5cff', 10),
    ('algorithms',    'Algorithms',    '#22c55e', 20),
    ('career',        'Career',        '#f59e0b', 30),
    ('behavioral',    'Behavioral',    '#ec4899', 40),
    ('languages',     'Languages',     '#06b6d4', 50)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE podcasts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_ru      TEXT NOT NULL,
    title_en      TEXT NOT NULL,
    description   TEXT,
    section       TEXT NOT NULL,
    duration_sec  INT NOT NULL,
    audio_key     TEXT NOT NULL,
    is_published  BOOLEAN NOT NULL DEFAULT FALSE,
    host          TEXT,
    category_id   UUID REFERENCES podcast_categories(id) ON DELETE SET NULL,
    episode_num   INT,
    cover_url     TEXT,
    published_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_podcasts_category_id  ON podcasts(category_id);
CREATE INDEX idx_podcasts_published_at ON podcasts(published_at DESC NULLS LAST);

CREATE TABLE podcast_progress (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    podcast_id    UUID NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    listened_sec  INT NOT NULL DEFAULT 0,
    completed_at  TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, podcast_id)
);

-- =============================================================
-- LLM CONFIG + MODELS + COPILOT + PERSONAS
-- =============================================================

CREATE TABLE embedding_models (
    id     SERIAL PRIMARY KEY,
    name   TEXT NOT NULL UNIQUE,
    dim    INT  NOT NULL
);
INSERT INTO embedding_models (name, dim) VALUES ('bge-small-en-v1.5', 384) ON CONFLICT (name) DO NOTHING;

CREATE TABLE llm_configs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type   TEXT NOT NULL,
    scope_id     TEXT,
    model        TEXT NOT NULL,
    temperature  NUMERIC(3,2) NOT NULL DEFAULT 0.7,
    max_tokens   INT NOT NULL DEFAULT 2048,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT llm_scope_valid CHECK (scope_type IN ('default','task','section','company','user'))
);

CREATE TABLE llm_models (
    id                     BIGSERIAL PRIMARY KEY,
    model_id               TEXT        NOT NULL UNIQUE,
    label                  TEXT        NOT NULL,
    provider               TEXT        NOT NULL,
    provider_id            TEXT        NOT NULL DEFAULT 'openrouter',
    is_virtual             BOOLEAN     NOT NULL DEFAULT FALSE,
    tier                   TEXT        NOT NULL DEFAULT 'free',
    is_enabled             BOOLEAN     NOT NULL DEFAULT TRUE,
    context_window         INT,
    cost_per_1k_input_usd  NUMERIC(8,6),
    cost_per_1k_output_usd NUMERIC(8,6),
    use_for_arena          BOOLEAN     NOT NULL DEFAULT TRUE,
    use_for_insight        BOOLEAN     NOT NULL DEFAULT TRUE,
    use_for_mock           BOOLEAN     NOT NULL DEFAULT TRUE,
    use_for_vacancies      BOOLEAN     NOT NULL DEFAULT FALSE,
    sort_order             INT         NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT llm_models_tier_valid CHECK (tier IN ('free','pro','max'))
);
CREATE INDEX llm_models_enabled_sort_idx ON llm_models (is_enabled, sort_order);

INSERT INTO llm_models (
    model_id, label, provider, provider_id, tier, is_virtual,
    use_for_arena, use_for_insight, use_for_mock, use_for_vacancies, sort_order
) VALUES
    ('druz9/turbo',                        'Турбо ⚡ (авто-роутинг)',         'druz9',     'druz9',      'free', TRUE,  TRUE,  TRUE,  TRUE,  TRUE,   1),
    ('openai/gpt-4o-mini',                 'GPT-4o mini',                    'openai',    'openrouter', 'pro',  FALSE, TRUE,  TRUE,  TRUE,  TRUE,  10),
    ('qwen/qwen3-coder:free',              'Qwen3 Coder (free)',             'qwen',      'openrouter', 'pro',  FALSE, FALSE, TRUE,  FALSE, TRUE,  11),
    ('openai/gpt-oss-120b:free',           'GPT-OSS 120B (free)',            'openai',    'openrouter', 'pro',  FALSE, FALSE, TRUE,  FALSE, FALSE, 12),
    ('openai/gpt-4o',                      'GPT-4o',                         'openai',    'openrouter', 'max',  FALSE, TRUE,  TRUE,  TRUE,  FALSE, 30),
    ('anthropic/claude-sonnet-4',          'Claude Sonnet 4',                'anthropic', 'openrouter', 'max',  FALSE, TRUE,  TRUE,  TRUE,  FALSE, 40),
    ('groq/llama-3.3-70b-versatile',       'Llama 3.3 70B (Groq)',           'groq',      'groq',       'pro',  FALSE, TRUE,  TRUE,  TRUE,  TRUE,  21),
    ('cerebras/llama3.3-70b',              'Llama 3.3 70B (Cerebras)',       'cerebras',  'cerebras',   'pro',  FALSE, TRUE,  TRUE,  TRUE,  TRUE,  31),
    ('google/gemini-2.5-flash',            'Gemini 2.5 Flash',               'google',    'google',     'pro',  FALSE, TRUE,  TRUE,  TRUE,  TRUE,  50),
    ('cloudflare/@cf/meta/llama-3.1-8b-instruct', 'Llama 3.1 8B (Cloudflare)', 'cloudflare', 'cloudflare', 'pro', FALSE, TRUE, TRUE, TRUE, TRUE, 60),
    ('zai/glm-4.5-flash',                  'GLM-4.5 Flash (Z.AI)',           'zai',       'zai',        'pro',  FALSE, TRUE,  TRUE,  TRUE,  TRUE,  70)
ON CONFLICT (model_id) DO NOTHING;

CREATE TABLE llm_runtime_config (
    id              INT PRIMARY KEY DEFAULT 1,
    chain_order     TEXT[] NOT NULL DEFAULT '{}'::text[],
    task_map        JSONB  NOT NULL DEFAULT '{}'::jsonb,
    virtual_chains  JSONB  NOT NULL DEFAULT '{}'::jsonb,
    version         INT    NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT llm_runtime_singleton CHECK (id = 1)
);
INSERT INTO llm_runtime_config (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE copilot_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,
    document_ids  UUID[] NOT NULL DEFAULT '{}'::uuid[],
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ,
    byok_only     BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT copilot_sessions_kind_valid CHECK (kind IN ('interview','work','casual'))
);
CREATE INDEX idx_copilot_sessions_user_started ON copilot_sessions(user_id, started_at DESC);
CREATE UNIQUE INDEX idx_copilot_sessions_live  ON copilot_sessions(user_id) WHERE finished_at IS NULL;
CREATE INDEX idx_copilot_sessions_document_ids ON copilot_sessions USING GIN (document_ids);

CREATE TABLE copilot_conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id      UUID REFERENCES copilot_sessions(id) ON DELETE SET NULL,
    title           TEXT NOT NULL DEFAULT '',
    model           TEXT NOT NULL,
    running_summary TEXT NOT NULL DEFAULT '',
    -- Phase II context-preservation: фактическая модель которая написала
    -- running_summary (provider/model echo от llmchain.Response). Используется
    -- для drift-детекции — если current chat model отличается от
    -- summary_model, summary мог писаться другим стилем.
    summary_model   TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_copilot_conversations_user_updated ON copilot_conversations(user_id, updated_at DESC);
CREATE INDEX idx_copilot_conversations_session ON copilot_conversations(session_id) WHERE session_id IS NOT NULL;

CREATE TABLE copilot_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    has_screenshot  BOOLEAN NOT NULL DEFAULT FALSE,
    tokens_in       INT NOT NULL DEFAULT 0,
    tokens_out      INT NOT NULL DEFAULT 0,
    latency_ms      INT NOT NULL DEFAULT 0,
    rating          SMALLINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT copilot_messages_role_valid   CHECK (role IN ('system','user','assistant')),
    CONSTRAINT copilot_messages_rating_valid CHECK (rating IS NULL OR rating IN (-1, 0, 1))
);
CREATE INDEX idx_copilot_messages_conv_created ON copilot_messages(conversation_id, created_at);

CREATE TABLE copilot_quotas (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan            TEXT NOT NULL DEFAULT 'free',
    requests_used   INT NOT NULL DEFAULT 0,
    requests_cap    INT NOT NULL DEFAULT 20,
    resets_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 day'),
    models_allowed  TEXT[] NOT NULL DEFAULT ARRAY['druz9/turbo']::TEXT[],
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT copilot_quotas_plan_valid CHECK (plan IN ('free','pro','max'))
);

CREATE TABLE copilot_session_reports (
    session_id        UUID PRIMARY KEY REFERENCES copilot_sessions(id) ON DELETE CASCADE,
    status            TEXT NOT NULL DEFAULT 'pending',
    overall_score     INT NOT NULL DEFAULT 0,
    section_scores    JSONB NOT NULL DEFAULT '{}'::JSONB,
    weaknesses        JSONB NOT NULL DEFAULT '[]'::JSONB,
    recommendations   JSONB NOT NULL DEFAULT '[]'::JSONB,
    links             JSONB NOT NULL DEFAULT '[]'::JSONB,
    report_markdown   TEXT NOT NULL DEFAULT '',
    report_url        TEXT NOT NULL DEFAULT '',
    error_message     TEXT NOT NULL DEFAULT '',
    started_at        TIMESTAMPTZ,
    finished_at       TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    analysis          JSONB NOT NULL DEFAULT '{}'::JSONB,
    title             TEXT  NOT NULL DEFAULT '',
    CONSTRAINT copilot_session_reports_status_valid
        CHECK (status IN ('pending','running','ready','failed'))
);

CREATE TABLE personas (
    id              TEXT        PRIMARY KEY,
    label           TEXT        NOT NULL,
    hint            TEXT        NOT NULL DEFAULT '',
    icon_emoji      TEXT        NOT NULL DEFAULT '💬',
    brand_gradient  TEXT        NOT NULL DEFAULT '',
    suggested_task  TEXT        NOT NULL DEFAULT '',
    system_prompt   TEXT        NOT NULL DEFAULT '',
    sort_order      INT         NOT NULL DEFAULT 100,
    is_enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX personas_enabled_sort_idx ON personas (is_enabled, sort_order);

INSERT INTO personas (id, label, hint, icon_emoji, sort_order) VALUES
    ('default',       'Обычный',        'Без специализации — универсальный режим',        '💬', 10),
    ('react',         'React Expert',   'React · TypeScript · Next.js · performance',     '⚛️', 20),
    ('system-design', 'System Design',  'Distributed systems · SRE · capacity planning',  '🏛️', 30),
    ('go-sre',        'Go / SRE',       'Go · Kubernetes · observability',                '🐹', 40),
    ('behavioral',    'Behavioral',     'STAR · leadership · conflict · trade-offs',      '🎭', 50),
    ('dsa',           'DSA',            'Algorithms · data structures · LeetCode-style',  '🧮', 60)
ON CONFLICT (id) DO NOTHING;

-- =============================================================
-- DOCUMENTS (RAG)
-- =============================================================

CREATE TABLE documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    mime          TEXT NOT NULL,
    size_bytes    BIGINT NOT NULL,
    sha256        TEXT NOT NULL,
    source_url    TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT NOT NULL DEFAULT '',
    chunk_count   INT NOT NULL DEFAULT 0,
    token_count   INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT documents_status_valid
        CHECK (status IN ('pending','extracting','embedding','ready','failed','deleting')),
    UNIQUE (user_id, sha256)
);
CREATE INDEX idx_documents_user_status ON documents(user_id, status);

CREATE TABLE doc_chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id          UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ord             INT NOT NULL,
    content         TEXT NOT NULL,
    embedding       REAL[],
    -- Phase IX: parallel pgvector column. dim=384 матчит bge-small-en-v1.5
    -- (см. embedding_models seed). При смене embedding-модели на 1536-dim
    -- (например text-embedding-3-small) — нужна отдельная миграция:
    -- ALTER TABLE doc_chunks ALTER COLUMN embedding_vec TYPE vector(1536),
    -- + MarkStaleForReembed; вектор-колонка фиксированной размерности
    -- по дизайну pgvector.
    embedding_vec   vector(384),
    token_count     INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_doc_chunks_doc ON doc_chunks(doc_id, ord);
-- IVFFlat cosine-distance index. lists=100 — sweet spot для 10k-1M rows;
-- для меньшего corpus'а partial index'ом (WHERE embedding_vec IS NOT NULL)
-- избегаем включать null'ы. Перебилд index'а после массового backfill'а.
CREATE INDEX idx_doc_chunks_embedding_vec
    ON doc_chunks USING ivfflat (embedding_vec vector_cosine_ops)
    WITH (lists = 100)
    WHERE embedding_vec IS NOT NULL;

CREATE TABLE session_documents (
    session_id  UUID NOT NULL REFERENCES copilot_sessions(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    PRIMARY KEY (session_id, document_id)
);

-- =============================================================
-- HONE: notes / focus / streaks / queue / whiteboards
-- =============================================================

CREATE TABLE hone_note_folders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    parent_id   UUID REFERENCES hone_note_folders(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hone_note_folders_user ON hone_note_folders(user_id);

CREATE TABLE hone_notes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title               TEXT NOT NULL DEFAULT '',
    body_md             TEXT NOT NULL DEFAULT '',
    size_bytes          INT  NOT NULL DEFAULT 0,
    folder_id           UUID REFERENCES hone_note_folders(id) ON DELETE SET NULL,
    -- v2: replaces hone_cue_sessions table; raw_analysis_json non-null only for kind='cue'
    kind                TEXT NOT NULL DEFAULT 'note',
    raw_analysis_json   JSONB,
    -- vault encryption (00035)
    encrypted           BOOLEAN NOT NULL DEFAULT FALSE,
    -- share-to-web (00031)
    public_slug         TEXT UNIQUE,
    published_at        TIMESTAMPTZ,
    -- vector search
    embedding           REAL[],
    -- Phase IX: parallel pgvector. См. doc_chunks.embedding_vec.
    embedding_vec       vector(384),
    embedding_model_id  INT REFERENCES embedding_models(id),
    embedded_at         TIMESTAMPTZ,
    -- Cue session attachment (kind='cue')
    file_path           TEXT,
    started_at          TIMESTAMPTZ,
    imported_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT hone_notes_kind_valid CHECK (kind IN ('note','cue','daily'))
);
CREATE INDEX idx_hone_notes_user_updated ON hone_notes(user_id, updated_at DESC);
CREATE INDEX idx_hone_notes_user_folder  ON hone_notes(user_id, folder_id);
CREATE INDEX idx_hone_notes_user_kind    ON hone_notes(user_id, kind);
CREATE INDEX idx_hone_notes_public_slug  ON hone_notes(public_slug) WHERE public_slug IS NOT NULL;
CREATE INDEX idx_hone_notes_embedded     ON hone_notes(user_id) WHERE embedded_at IS NOT NULL;
-- Phase IX: pgvector index. lists=100 — для до ~10k нот на user'а;
-- при росте per-user corpus к 100k можно ALTER к 200-500. Partial по
-- NOT NULL чтобы не индексировать pending-embedding rows.
CREATE INDEX idx_hone_notes_embedding_vec
    ON hone_notes USING ivfflat (embedding_vec vector_cosine_ops)
    WITH (lists = 100)
    WHERE embedding_vec IS NOT NULL;
CREATE UNIQUE INDEX idx_hone_notes_user_file_path
    ON hone_notes(user_id, file_path) WHERE file_path IS NOT NULL;

CREATE TABLE hone_focus_sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id            UUID,
    plan_item_id       TEXT NOT NULL DEFAULT '',
    pinned_title       TEXT NOT NULL DEFAULT '',
    mode               TEXT NOT NULL DEFAULT 'free',
    started_at         TIMESTAMPTZ NOT NULL,
    ended_at           TIMESTAMPTZ,
    pomodoros_completed INT NOT NULL DEFAULT 0,
    seconds_focused    INT NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT hone_focus_mode_valid CHECK (mode IN ('free','plan','pinned'))
);
CREATE INDEX idx_hone_focus_user_started ON hone_focus_sessions(user_id, started_at DESC);

CREATE TABLE hone_streak_days (
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day               DATE NOT NULL,
    focused_seconds   INT NOT NULL DEFAULT 0,
    sessions_count    INT NOT NULL DEFAULT 0,
    qualifies_streak  BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, day)
);
CREATE INDEX idx_hone_streak_days_user_day ON hone_streak_days(user_id, day DESC);

CREATE TABLE hone_streak_state (
    user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak    INT NOT NULL DEFAULT 0,
    longest_streak    INT NOT NULL DEFAULT 0,
    last_qualified    DATE,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hone_daily_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_date       DATE NOT NULL,
    items           JSONB NOT NULL DEFAULT '[]'::jsonb,
    regenerated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, plan_date)
);

CREATE TABLE hone_plan_skips (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_key   TEXT NOT NULL,
    skipped_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hone_plan_skips_user_skipped ON hone_plan_skips(user_id, skipped_at DESC);

CREATE TABLE hone_queue_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'user',
    status      TEXT NOT NULL DEFAULT 'todo',
    item_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    skill_key   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT hone_queue_source_valid CHECK (source IN ('ai','user')),
    CONSTRAINT hone_queue_status_valid CHECK (status IN ('todo','in_progress','done'))
);
CREATE INDEX idx_hone_queue_user_date_status ON hone_queue_items(user_id, item_date, status);

CREATE TABLE note_yjs_updates (
    seq         BIGSERIAL PRIMARY KEY,
    note_id     UUID NOT NULL REFERENCES hone_notes(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    update_data BYTEA NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_note_yjs_updates_note_seq ON note_yjs_updates(note_id, seq);

CREATE TABLE hone_whiteboards (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    state_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
    version     INT  NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hone_whiteboards_user_updated ON hone_whiteboards(user_id, updated_at DESC);

CREATE TABLE whiteboard_rooms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    snapshot    BYTEA,
    expires_at  TIMESTAMPTZ NOT NULL,
    visibility  TEXT NOT NULL DEFAULT 'shared',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT whiteboard_rooms_visibility_valid CHECK (visibility IN ('private','shared'))
);
CREATE INDEX idx_whiteboard_rooms_owner   ON whiteboard_rooms(owner_id);
CREATE INDEX idx_whiteboard_rooms_expires ON whiteboard_rooms(expires_at);

CREATE TABLE whiteboard_room_participants (
    room_id   UUID NOT NULL REFERENCES whiteboard_rooms(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_whiteboard_participants_user ON whiteboard_room_participants(user_id);

CREATE TABLE whiteboard_yjs_updates (
    seq          BIGSERIAL PRIMARY KEY,
    whiteboard_id UUID NOT NULL REFERENCES hone_whiteboards(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    update_data  BYTEA NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wb_yjs_updates_wb_seq ON whiteboard_yjs_updates(whiteboard_id, seq);

-- =============================================================
-- HONE TASKBOARD (NEW v2)
-- =============================================================

CREATE TABLE hone_tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'todo',
    kind                TEXT NOT NULL,
    source              TEXT NOT NULL,
    title               TEXT NOT NULL,
    brief_md            TEXT NOT NULL DEFAULT '',
    skill_key           TEXT REFERENCES atlas_nodes(id) ON DELETE SET NULL,
    deep_link           TEXT NOT NULL DEFAULT '',
    recommended_reading TEXT[] NOT NULL DEFAULT '{}'::text[],
    priority            SMALLINT NOT NULL DEFAULT 0,
    due_at              TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    dismissed_at        TIMESTAMPTZ,
    CONSTRAINT hone_tasks_status_valid CHECK (status IN ('todo','in_progress','in_review','done','dismissed')),
    CONSTRAINT hone_tasks_kind_valid   CHECK (kind   IN ('algo','sysdesign','quiz','reflection','reading','custom')),
    CONSTRAINT hone_tasks_source_valid CHECK (source IN ('ai','user'))
);
CREATE INDEX idx_hone_tasks_user_status_created ON hone_tasks(user_id, status, created_at DESC);
CREATE INDEX idx_hone_tasks_user_skill_open
    ON hone_tasks(user_id, skill_key)
    WHERE status IN ('todo','in_progress','in_review') AND skill_key IS NOT NULL;
CREATE INDEX idx_hone_tasks_user_todo_created
    ON hone_tasks(user_id, created_at)
    WHERE status = 'todo';

CREATE TABLE hone_task_comments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id      UUID NOT NULL REFERENCES hone_tasks(id) ON DELETE CASCADE,
    author_kind  TEXT NOT NULL,
    body_md      TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT hone_task_comments_author_valid CHECK (author_kind IN ('ai','user'))
);
CREATE INDEX idx_hone_task_comments_task ON hone_task_comments(task_id, created_at);

-- =============================================================
-- INTELLIGENCE / COACH MEMORY
-- =============================================================

CREATE TABLE coach_episodes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind                TEXT NOT NULL,
    summary             TEXT NOT NULL DEFAULT '',
    payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding           REAL[],
    -- Phase IX: parallel pgvector. См. doc_chunks.embedding_vec.
    embedding_vec       vector(384),
    embedding_model_id  INT REFERENCES embedding_models(id),
    embedded_at         TIMESTAMPTZ,
    occurred_at         TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_coach_episodes_user_kind_time     ON coach_episodes(user_id, kind, occurred_at DESC);
CREATE INDEX idx_coach_episodes_user_time          ON coach_episodes(user_id, occurred_at DESC);
CREATE INDEX idx_coach_episodes_user_embedded_time
    ON coach_episodes(user_id, occurred_at DESC) WHERE embedded_at IS NOT NULL;
CREATE INDEX idx_coach_episodes_user_kind_embedded_time
    ON coach_episodes(user_id, kind, occurred_at DESC) WHERE embedded_at IS NOT NULL;
CREATE INDEX idx_coach_episodes_brief_emitted_brief_id
    ON coach_episodes(user_id, (payload->>'brief_id'), created_at DESC)
    WHERE kind = 'brief_emitted';
CREATE INDEX idx_coach_episodes_pending_embedding
    ON coach_episodes(created_at) WHERE embedded_at IS NULL;
-- Phase IX: pgvector index. lists=100 для до ~10k эпизодов на user'а
-- (90-day retention уже бьёт). При scale up — ALTER к 200+ + REINDEX.
CREATE INDEX idx_coach_episodes_embedding_vec
    ON coach_episodes USING ivfflat (embedding_vec vector_cosine_ops)
    WITH (lists = 100)
    WHERE embedding_vec IS NOT NULL;

CREATE TABLE hone_daily_briefs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brief_date      DATE NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, brief_date)
);
CREATE INDEX idx_hone_daily_briefs_user_date ON hone_daily_briefs(user_id, brief_date DESC);

-- =============================================================
-- EDITOR ROOMS (collaborative)
-- =============================================================

CREATE TABLE editor_rooms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL DEFAULT 'practice',
    task_id     UUID REFERENCES tasks(id),
    language    TEXT NOT NULL,
    is_frozen   BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at  TIMESTAMPTZ NOT NULL,
    visibility  TEXT NOT NULL DEFAULT 'shared',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT editor_rooms_visibility_valid CHECK (visibility IN ('private','shared'))
);
CREATE INDEX idx_editor_rooms_owner ON editor_rooms(owner_id);

CREATE TABLE editor_participants (
    room_id   UUID NOT NULL REFERENCES editor_rooms(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, user_id),
    CONSTRAINT editor_participants_role_valid CHECK (role IN ('owner','interviewer','participant','viewer'))
);

-- =============================================================
-- DEVICES & SYNC
-- =============================================================

CREATE TABLE devices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL DEFAULT '',
    platform      TEXT NOT NULL,
    last_seen_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT devices_platform_valid CHECK (platform IN ('mac','ios','android','web','linux','windows'))
);
CREATE INDEX idx_devices_user ON devices(user_id) WHERE revoked_at IS NULL;

CREATE TABLE sync_tombstones (
    id               BIGSERIAL PRIMARY KEY,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    table_name       TEXT NOT NULL,
    row_id           UUID NOT NULL,
    deleted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    origin_device_id UUID
);
CREATE INDEX idx_sync_tombstones_user_deleted ON sync_tombstones(user_id, deleted_at DESC);

-- =============================================================
-- LOBBIES (custom-match flow)
-- =============================================================

CREATE TABLE lobbies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            CHAR(4) NOT NULL UNIQUE,
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
    CONSTRAINT lobbies_mode_valid       CHECK (mode IN ('1v1','2v2')),
    CONSTRAINT lobbies_visibility_valid CHECK (visibility IN ('public','unlisted','private')),
    CONSTRAINT lobbies_status_valid     CHECK (status IN ('open','live','cancelled')),
    CONSTRAINT lobbies_max_members_range CHECK (max_members BETWEEN 2 AND 4),
    CONSTRAINT lobbies_time_limit_range  CHECK (time_limit_min BETWEEN 5 AND 180),
    CONSTRAINT lobbies_code_format CHECK (code ~ '^[A-Z]{4}$')
);
CREATE INDEX idx_lobbies_public_list ON lobbies(visibility, status, created_at DESC) WHERE status = 'open';

CREATE TABLE lobby_members (
    lobby_id   UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    role       TEXT NOT NULL DEFAULT 'member',
    team       SMALLINT NOT NULL DEFAULT 1,
    PRIMARY KEY (lobby_id, user_id),
    CONSTRAINT lobby_members_role_valid CHECK (role IN ('owner','member')),
    CONSTRAINT lobby_members_team_valid CHECK (team IN (1,2))
);
CREATE INDEX idx_lobby_members_user ON lobby_members(user_id);

-- =============================================================
-- CIRCLES + EVENTS (community)
-- =============================================================

CREATE TABLE circles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE circle_members (
    circle_id  UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'member',
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (circle_id, user_id),
    CONSTRAINT circle_members_role_valid CHECK (role IN ('member','admin','owner'))
);
CREATE INDEX idx_circle_members_user ON circle_members(user_id);

CREATE TABLE events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id           UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    starts_at           TIMESTAMPTZ NOT NULL,
    duration_min        INT NOT NULL DEFAULT 60,
    editor_room_id      UUID REFERENCES editor_rooms(id) ON DELETE SET NULL,
    whiteboard_room_id  UUID REFERENCES whiteboard_rooms(id) ON DELETE SET NULL,
    recurrence_rule     TEXT,
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_circle_starts ON events(circle_id, starts_at);

CREATE TABLE event_participants (
    event_id  UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id)
);

CREATE TABLE event_notification_sent (
    event_id  UUID NOT NULL,
    user_id   UUID NOT NULL,
    kind      TEXT NOT NULL,
    sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id, kind),
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
);

-- =============================================================
-- CODEX (knowledge base + quiz)
-- =============================================================

CREATE TABLE codex_categories (
    slug         TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    sort_order   INT  NOT NULL DEFAULT 0,
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE codex_articles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT UNIQUE NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL REFERENCES codex_categories(slug) ON DELETE RESTRICT,
    href            TEXT NOT NULL DEFAULT '',
    source          TEXT NOT NULL DEFAULT '',
    read_min        INT  NOT NULL DEFAULT 0,
    sort_order      INT  NOT NULL DEFAULT 0,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    -- v2 quiz extension
    quiz_question   TEXT,
    quiz_answer     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_codex_articles_active ON codex_articles(active, sort_order);

-- =============================================================
-- MOCK INTERVIEW PIPELINE
-- =============================================================

CREATE TYPE mock_pipeline_verdict AS ENUM ('in_progress','pass','fail','cancelled');

CREATE TABLE mock_pipelines (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id        UUID REFERENCES companies(id),
    role_label        TEXT NOT NULL DEFAULT '',
    section           TEXT NOT NULL DEFAULT '',
    ai_assist         BOOLEAN NOT NULL DEFAULT false,
    current_stage_idx SMALLINT NOT NULL DEFAULT 0,
    verdict           mock_pipeline_verdict NOT NULL DEFAULT 'in_progress',
    total_score       REAL,
    started_at        TIMESTAMPTZ,
    finished_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mock_pipelines_user ON mock_pipelines(user_id, created_at DESC);

CREATE TABLE pipeline_stages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id  UUID NOT NULL REFERENCES mock_pipelines(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    sort_order   INT NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id, sort_order);

CREATE TABLE pipeline_attempts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_id     UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
    user_answer  TEXT,
    ai_feedback  JSONB,
    score        INT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);

CREATE TABLE mock_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section         TEXT NOT NULL,
    difficulty      TEXT NOT NULL,
    title           TEXT NOT NULL,
    brief_md        TEXT NOT NULL DEFAULT '',
    language        TEXT,
    llm_model       TEXT,
    expected_keywords TEXT[] NOT NULL DEFAULT '{}'::text[],
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mock_task_test_cases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mock_task_id UUID NOT NULL REFERENCES mock_tasks(id) ON DELETE CASCADE,
    input_md    TEXT NOT NULL,
    expected    TEXT NOT NULL DEFAULT '',
    weight      INT NOT NULL DEFAULT 1
);

CREATE TABLE company_stages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE stage_default_questions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_kind   TEXT NOT NULL,
    question_md  TEXT NOT NULL,
    answer_hint  TEXT
);

CREATE TABLE company_questions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    stage_kind   TEXT NOT NULL,
    question_md  TEXT NOT NULL,
    answer_hint  TEXT
);

CREATE TABLE task_questions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mock_task_id UUID NOT NULL REFERENCES mock_tasks(id) ON DELETE CASCADE,
    question_md  TEXT NOT NULL,
    answer_hint  TEXT
);

CREATE TABLE ai_strictness_profiles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- +goose StatementEnd

-- ============================================================
-- Phase 1-4 + Wave 0-6 incremental patches (consolidated)
-- ============================================================

-- ── from 00002_mock_schema_align.sql ──
-- +goose StatementBegin

-- 00002_mock_schema_align.sql
--
-- Aligns six mock-interview tables with the shape Go code already expects.
-- The 00001 baseline was authored before the mock_interview Phase B/C
-- refactor; the runtime queries SELECT columns that don't exist yet, which
-- surfaces as 500 "internal" on every admin/mock list endpoint
-- (default-questions, strictness, tasks, etc).
--
-- Strategy: DROP + CREATE for the six tables. They are infrastructural —
-- their content is admin-curated CMS, not user data — so a clean rebuild
-- is safer than a long ALTER chain. Down block is the conventional
-- baseline-style no-op (rebuild from scratch on rollback).
--
-- Tables touched (in FK-safe order):
--   1. mock_task_test_cases  — depends on mock_tasks
--   2. task_questions        — depends on mock_tasks
--   3. company_questions     — depends on companies
--   4. stage_default_questions
--   5. mock_tasks            — depends on ai_strictness_profiles
--   6. ai_strictness_profiles
--
-- Drops use CASCADE only where children are recreated below — there are no
-- external readers of these tables outside the mock_interview bounded
-- context.

DROP TABLE IF EXISTS mock_task_test_cases CASCADE;
DROP TABLE IF EXISTS task_questions CASCADE;
DROP TABLE IF EXISTS company_questions CASCADE;
DROP TABLE IF EXISTS stage_default_questions CASCADE;
DROP TABLE IF EXISTS mock_tasks CASCADE;
DROP TABLE IF EXISTS ai_strictness_profiles CASCADE;

-- ai_strictness_profiles — referenced by mock_tasks.ai_strictness_profile_id.
-- Slug is the public identifier; name is human-facing. Penalty fields are
-- deductions applied to the LLM judge's score (0..1).
CREATE TABLE ai_strictness_profiles (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                     TEXT NOT NULL UNIQUE,
    name                     TEXT NOT NULL,
    off_topic_penalty        DOUBLE PRECISION NOT NULL DEFAULT 0,
    must_mention_penalty     DOUBLE PRECISION NOT NULL DEFAULT 0,
    hallucination_penalty    DOUBLE PRECISION NOT NULL DEFAULT 0,
    bias_toward_fail         DOUBLE PRECISION NOT NULL DEFAULT 0,
    custom_prompt_template   TEXT,
    active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: a single 'standard' profile so mock_tasks.ai_strictness_profile_id
-- can FK to something even on a fresh DB. UI lets admins add more.
INSERT INTO ai_strictness_profiles (slug, name, off_topic_penalty, must_mention_penalty, hallucination_penalty, bias_toward_fail)
VALUES ('standard', 'Стандарт', 0.1, 0.15, 0.2, 0.0);

-- mock_tasks — the catalog of interview tasks the orchestrator pulls from.
-- stage_kind determines which stage of the pipeline can ask this task;
-- language is the runtime expected by Judge0 ('any' for stages without
-- code execution).
CREATE TABLE mock_tasks (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_kind                  TEXT NOT NULL,
    language                    TEXT NOT NULL DEFAULT 'any',
    difficulty                  SMALLINT NOT NULL DEFAULT 2,
    title                       TEXT NOT NULL,
    body_md                     TEXT NOT NULL DEFAULT '',
    sample_io_md                TEXT NOT NULL DEFAULT '',
    reference_criteria          JSONB NOT NULL DEFAULT '[]'::jsonb,
    reference_solution_md       TEXT NOT NULL DEFAULT '',
    functional_requirements_md  TEXT NOT NULL DEFAULT '',
    time_limit_min              INT NOT NULL DEFAULT 30,
    ai_strictness_profile_id    UUID REFERENCES ai_strictness_profiles(id) ON DELETE SET NULL,
    llm_model                   TEXT,
    active                      BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_admin_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mock_tasks_stage_kind_active_idx
    ON mock_tasks (stage_kind, active);

-- task_questions — follow-up questions tied to a specific task.
CREATE TABLE task_questions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             UUID NOT NULL REFERENCES mock_tasks(id) ON DELETE CASCADE,
    body                TEXT NOT NULL,
    expected_answer_md  TEXT NOT NULL DEFAULT '',
    reference_criteria  JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order          INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX task_questions_task_id_idx ON task_questions (task_id, sort_order);

-- mock_task_test_cases — Judge0 test inputs for code-stage tasks.
-- ordinal drives display order; is_hidden flags cases not shown to user
-- (Judge0 evaluates them but they're hidden for anti-overfit).
CREATE TABLE mock_task_test_cases (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id           UUID NOT NULL REFERENCES mock_tasks(id) ON DELETE CASCADE,
    input             TEXT NOT NULL,
    expected_output   TEXT NOT NULL DEFAULT '',
    is_hidden         BOOLEAN NOT NULL DEFAULT FALSE,
    ordinal           INT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mock_task_test_cases_task_idx
    ON mock_task_test_cases (task_id, ordinal);

-- stage_default_questions — fallback questions used when neither company nor
-- task supplies one for a stage. stage_kind narrows the pool.
CREATE TABLE stage_default_questions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_kind          TEXT NOT NULL,
    body                TEXT NOT NULL,
    expected_answer_md  TEXT NOT NULL DEFAULT '',
    reference_criteria  JSONB NOT NULL DEFAULT '[]'::jsonb,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order          INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX stage_default_questions_stage_idx
    ON stage_default_questions (stage_kind, active, sort_order);

-- company_questions — company-flavoured fallback questions per stage.
-- Picked over stage_default_questions when the pipeline is bound to a
-- specific company.
CREATE TABLE company_questions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    stage_kind          TEXT NOT NULL,
    body                TEXT NOT NULL,
    expected_answer_md  TEXT NOT NULL DEFAULT '',
    reference_criteria  JSONB NOT NULL DEFAULT '[]'::jsonb,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order          INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX company_questions_company_stage_idx
    ON company_questions (company_id, stage_kind, active, sort_order);

-- +goose StatementEnd


-- ── from 00003_personal_events.sql ──
-- +goose StatementBegin

-- 00003_personal_events.sql
--
-- Personal calendar surface — events that belong to one user, not a circle.
-- This unifies what was scattered before:
--   • interview_calendars     → personal_events with kind='interview'
--   • ad-hoc deadlines        → kind='deadline'
--   • exam reminders          → kind='exam'
--   • club_session reflections → kind='club_session' (cross-link to clubs)
--   • personal study blocks   → kind='study_block'
--
-- Why a new table instead of extending interview_calendars: kind matters
-- for severity grading in the AI coach (interview ≤3 days = critical;
-- deadline ≤2 days = critical; club_session = inform). A single typed
-- model lets one Reader feed every code path that asks "what's coming up
-- for this user?".
--
-- interview_calendars is NOT dropped here — backwards compatibility for
-- legacy reads. A view-replacement and the data-migration are scheduled
-- for Phase 1b once the new RPC is live and the UI flips over.
--
-- Outcome capture is on the same row (status + outcome_md + felt_score)
-- so the coach memory loop can read post-event reflections directly,
-- without joining a sidecar table.

CREATE TYPE personal_event_kind AS ENUM (
    'interview',
    'deadline',
    'exam',
    'club_session',
    'study_block',
    'interview_prep_block'
);

CREATE TYPE personal_event_status AS ENUM (
    'planned',
    'live',
    'done',
    'cancelled',
    'no_show'
);

CREATE TABLE personal_events (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind               personal_event_kind NOT NULL,
    title              TEXT NOT NULL,
    description_md     TEXT NOT NULL DEFAULT '',
    -- Time anchor. all_day rows have starts_at = midnight UTC of the day,
    -- ends_at NULL — readers convert to local in UI. Otherwise both fields
    -- are populated; ends_at NULL means "open-ended" (rare).
    starts_at          TIMESTAMPTZ NOT NULL,
    ends_at            TIMESTAMPTZ,
    all_day            BOOLEAN NOT NULL DEFAULT FALSE,

    -- Optional cross-context links. NULL when irrelevant; coach reads
    -- through these to decide which surfaces should highlight the event.
    company_id         UUID REFERENCES companies(id) ON DELETE SET NULL,
    role               TEXT NOT NULL DEFAULT '',          -- e.g. "Backend Senior"
    current_level      TEXT NOT NULL DEFAULT '',          -- e.g. "L4"
    readiness_pct      SMALLINT NOT NULL DEFAULT 0
        CHECK (readiness_pct BETWEEN 0 AND 100),
    codex_article_slug TEXT NOT NULL DEFAULT '',          -- pinned pre-read
    track_id           UUID,                              -- forward-FK to tracks (Phase 2)
    club_session_id    UUID,                              -- forward-FK to club_sessions (Phase 3)

    -- Lifecycle.
    status             personal_event_status NOT NULL DEFAULT 'planned',
    -- After-event reflection (UpsertOutcome). Coach pulls this into
    -- intelligence.Memory as `event_outcome_recorded` episodes.
    outcome_md         TEXT NOT NULL DEFAULT '',
    felt_score         SMALLINT
        CHECK (felt_score IS NULL OR felt_score BETWEEN 1 AND 5),
    finished_at        TIMESTAMPTZ,

    source             TEXT NOT NULL DEFAULT 'user'       -- user|ai|club_curator|integration_tg
        CHECK (source IN ('user','ai','club_curator','integration_tg')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Coach + UI read paths: by user, ordered by date, narrowed to upcoming.
CREATE INDEX personal_events_user_starts_idx
    ON personal_events (user_id, starts_at);

-- Filter on kind for "show only my interviews" / "deadlines this week".
CREATE INDEX personal_events_user_kind_starts_idx
    ON personal_events (user_id, kind, starts_at);

-- Severity grading wants to find rows in a (today, today + N days) window
-- across the whole product (cron jobs, notifier). Partial index keeps it
-- cheap even when the table grows.
CREATE INDEX personal_events_upcoming_idx
    ON personal_events (starts_at)
    WHERE status = 'planned';

-- +goose StatementEnd


-- ── from 00004_remove_friends.sql ──
-- +goose StatementBegin

-- 00004_remove_friends.sql
--
-- Drops the friends bounded context entirely. Decision: социальный граф
-- живёт в Telegram-канале + circles, а внутри-приложения "друзей"
-- быть не должно — feature не дочитывалась пользователями и
-- порождала странные карточки в профиле без живой механики.
--
-- Removed:
--   • friendships         — pairwise friendship state
--   • friend_codes        — invite codes
--   • profile.in_friends  — percentile-band that depended on the table
--                            (inlined as 0 in code; stays in proto for
--                            backwards-compat, frontend stops rendering it).
--
-- Cascade is safe: the only FKs into these tables are user-scoped and
-- get rebuilt on user delete anyway. There are no cross-context FKs
-- referencing friendships outside the friends service.

DROP TABLE IF EXISTS friend_codes  CASCADE;
DROP TABLE IF EXISTS friendships   CASCADE;

-- +goose StatementEnd


-- ── from 00005_insights.sql ──
-- +goose StatementBegin

-- 00005_insights.sql
--
-- Insight stream — атомарные «факты дня» от AI-coach. Каждый insight =
-- (severity × surface × anchor × headline+evidence+lever+deepLink).
-- Это замена толстого DailyBrief как UI-юнита: web/today, hone/today,
-- arena/insights, codex/insights — все читают тот же поток с разным
-- surface-фильтром. DailyBrief остаётся как цельный narrative-документ
-- для weekly-recap, но день-в-день UX крутится вокруг insight'ов.
--
-- Why a separate table (а не виден через DailyBrief envelope):
--   1. UI surfaces расходятся (Hone компактный chip, web — большая
--      карточка). Один общий стрим с filter'ом проще двух разных
--      рендеров над разными фигурами proto.
--   2. Атомарность важна для acked: юзер dismissed конкретный insight,
--      а не весь brief.
--   3. Generation cron может производить пачку на (user, day) и не
--      писать единый brief — гибче, мы не платим за полный brief
--      генерации каждый раз.
--
-- expires_at: insight'ы коротко-живущие (24h дефолт). Reader фильтрует
-- по expires_at > now(). cron-cleanup чистит истёкшие.

CREATE TYPE insight_severity AS ENUM ('cruise', 'nudge', 'warn', 'critical');

-- Surface targets where this insight should appear. Storing as text
-- (not enum) so adding a surface later — say 'stealth' for Cue copilot
-- — doesn't require a SQL ALTER TYPE migration.
--
-- Known values today:
--   'today'  — main /today feed (web) + Hone Today ribbon (3 top)
--   'arena'  — /arena bottom contextual chip
--   'mock'   — /mock company-picker side
--   'codex'  — /codex inline reading-time nudge
CREATE TABLE intelligence_insights (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    surface       TEXT NOT NULL,
    severity      insight_severity NOT NULL DEFAULT 'nudge',

    -- Anchor stably identifies "what this insight is about" so we can
    -- dedupe across days. Examples:
    --   event:yandex_2026-05-08
    --   skill:caching
    --   streak:kata
    --   absence:welcome_back
    -- The same anchor on the same user+surface gets upserted, not
    -- duplicated — generator owns this contract.
    anchor        TEXT NOT NULL,

    headline      TEXT NOT NULL,
    evidence      TEXT NOT NULL DEFAULT '',  -- 1 sentence, numbers
    interpret     TEXT NOT NULL DEFAULT '',  -- 1 sentence, why this is a pattern
    lever         TEXT NOT NULL DEFAULT '',  -- 1 sentence, action today
    deep_link     TEXT NOT NULL DEFAULT '',  -- in-app route or empty

    -- Optional cross-context anchors. Generator fills when relevant.
    event_id      UUID,                      -- forward-FK to personal_events
    skill_key     TEXT NOT NULL DEFAULT '',  -- 'caching', 'dp', etc
    codex_slug    TEXT NOT NULL DEFAULT '',
    track_id      UUID,                      -- forward-FK to tracks (Phase 2)

    -- User feedback tap.
    dismissed_at  TIMESTAMPTZ,
    acted_at      TIMESTAMPTZ,

    generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 24h default lifetime. Override per-row when generator wants a
    -- longer window (e.g. interview-prep insight pinned for 7 days).
    expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),

    UNIQUE (user_id, surface, anchor)
);

-- Read path for the lane feeds: by-surface, freshest first, dismissed
-- + expired filtered out at query time.
CREATE INDEX intelligence_insights_user_surface_idx
    ON intelligence_insights (user_id, surface, generated_at DESC);

-- Periodic cleanup tap.
CREATE INDEX intelligence_insights_expires_idx
    ON intelligence_insights (expires_at)
    WHERE dismissed_at IS NULL;

-- +goose StatementEnd


-- ── from 00006_event_reminders_sent.sql ──
-- +goose StatementBegin

-- 00006_event_reminders_sent.sql
--
-- Dedup ledger for outbound personal-event reminders (T-24h, T-1h,
-- T-now). Each (event_id, horizon) writes once; cron worker checks
-- this table before sending so a Hone-side reminder + backend TG
-- reminder can both run without doubling-up notifications.
--
-- Why a separate table (not a column on personal_events): horizons are
-- multiple per row (3 reminders for one interview) and we want a
-- compact UNIQUE constraint that's easy to extend with new horizons
-- (e.g. T-7d for "interview scheduled, start prep").

CREATE TYPE personal_event_reminder_horizon AS ENUM ('t24h', 't1h', 'now');

CREATE TABLE personal_event_reminders_sent (
    event_id   UUID NOT NULL REFERENCES personal_events(id) ON DELETE CASCADE,
    horizon    personal_event_reminder_horizon NOT NULL,
    -- Channel identifier so a future per-channel suppression can read
    -- this directly. Today only 'tg'; 'web_push' / 'hone_native' may
    -- come later.
    channel    TEXT NOT NULL DEFAULT 'tg',
    sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, horizon, channel)
);

CREATE INDEX personal_event_reminders_sent_event_idx
    ON personal_event_reminders_sent (event_id);

-- +goose StatementEnd


-- ── from 00006_user_persona_tracks.sql ──
-- +goose StatementBegin

-- 00006_user_persona_tracks.sql
--
-- Multi-track foundation for the onboarding fork: a user can be on
-- one or many parallel tracks (e.g. "Senior dev + English"). This is
-- the data layer for docs/feature/tracks.md and the prerequisite for
-- the senior dev pack, English, and switcher tracks (sysanalyst,
-- product analyst).
--
-- Why a separate table instead of extending users.focus_class:
--   • focus_class is single-valued ('algo' | 'backend' | ...). Tracks
--     need to be multi-valued (one user can prep for senior dev AND
--     learn English in parallel — that's the sticky combo).
--   • Per-track metadata: seniority for engineering tracks, started_at
--     for cohort analysis, last_active_at to drive Insights.
--   • Extensible: adding a track = adding an enum value; no schema churn.
--
-- focus_class stays as-is for now (algo/backend/system specialization
-- within a dev track). It's orthogonal to track_kind and may be
-- migrated into per-track Atlas branches later.
--
-- Backfill: every existing user gets ('dev', 'middle', primary=true)
-- so the current UX doesn't suddenly route them to onboarding.

CREATE TYPE track_kind AS ENUM (
    'dev',
    'dev_senior',
    'sysanalyst',
    'product_analyst',
    'qa',
    'english'
);

CREATE TABLE IF NOT EXISTS user_persona_tracks (
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track          track_kind   NOT NULL,
    seniority      TEXT,                                                  -- 'junior'|'middle'|'senior'|'lead' for dev/sysanalyst/qa; NULL for english
    primary_track  BOOLEAN      NOT NULL DEFAULT FALSE,                    -- the "main" track shown first in UI
    started_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, track),
    CONSTRAINT user_persona_tracks_seniority_valid
        CHECK (seniority IS NULL OR seniority IN ('junior','middle','senior','lead'))
);

-- One primary track per user. Partial unique index — applies only
-- where primary_track=true, allowing many non-primary rows per user.
CREATE UNIQUE INDEX idx_user_persona_tracks_one_primary
    ON user_persona_tracks (user_id) WHERE primary_track = TRUE;

CREATE INDEX idx_user_persona_tracks_track_lastactive
    ON user_persona_tracks (track, last_active_at DESC);

-- Backfill: existing users get a 'dev' middle track marked primary so
-- existing flows (Atlas, Insights, Today) keep working without prompting
-- onboarding.
INSERT INTO user_persona_tracks (user_id, track, seniority, primary_track)
SELECT id, 'dev'::track_kind, 'middle', TRUE
FROM users
ON CONFLICT (user_id, track) DO NOTHING;

-- +goose StatementEnd


-- ── from 00007_skill_atlas_tracks.sql ──
-- +goose StatementBegin

-- 00007_skill_atlas_tracks.sql
--
-- Add track_kind to atlas_nodes so Skill Atlas can be filtered by the
-- user's active track(s). Required by docs/feature/tracks.md — without
-- this column the Atlas page can't render different content for
-- "Senior dev", "English", or "Sysanalyst" personas without massive
-- application-side filtering.
--
-- Design choice: single-valued track_kind on atlas_nodes (Option A
-- in plan.md). If the same skill ever needs to live in two tracks,
-- we duplicate the row — simpler than a junction table and the
-- duplication cost is small since cross-track nodes are rare. We can
-- migrate to atlas_node_tracks (M:N) later if reuse becomes painful.
--
-- Existing nodes default to 'dev' — that's where the current 50-task
-- catalog and the existing Atlas tree live.
--
-- The track_kind ENUM was created in 00006_user_tracks.sql. We reuse
-- it here so user_tracks.track and atlas_nodes.track_kind share a
-- single source of truth.

ALTER TABLE atlas_nodes
    ADD COLUMN IF NOT EXISTS track_kind track_kind NOT NULL DEFAULT 'dev';

-- Partial index per track. Atlas page hits this on every render with
-- WHERE is_active = TRUE AND track_kind = ANY($1).
CREATE INDEX IF NOT EXISTS idx_atlas_nodes_active_track
    ON atlas_nodes (track_kind, section)
    WHERE is_active = TRUE;

-- +goose StatementEnd


-- ── from 00007_tracks.sql ──
-- +goose StatementBegin

-- 00007_tracks.sql
--
-- Phase 2 — Atlas → Tracks. A Track is a curated programme: ordered
-- sequence of steps, each step a (skill_keys, required_kind, count)
-- tuple. The Atlas graph stays as the *visual core* of the track-detail
-- page (each step renders as a node connected to the prerequisites);
-- the catalogue's primary navigation moves from "skills" to "tracks".
--
-- Tables:
--   tracks         — curated catalogue (admin-authored) + future user forks
--   track_steps    — ordered checklist per track
--   user_tracks    — per-user enrolment + progress counter
--
-- Why three tables (vs. embedding steps as JSONB): the coach reads
-- step-level progress to flag "track stalled 5 days on step 4" — that's
-- a join query against user_tracks.current_step + a count from the
-- relevant kind tables. Embedding would force re-parsing JSONB on every
-- coach tick.

CREATE TABLE tracks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    tagline         TEXT NOT NULL DEFAULT '',
    description_md  TEXT NOT NULL DEFAULT '',
    cover_image_url TEXT NOT NULL DEFAULT '',
    accent_color    TEXT NOT NULL DEFAULT '#FFFFFF',

    -- curator_id NULL for the seeded curated catalogue (admin-authored,
    -- shared by everyone). Forks (Phase 2 follow-up) carry the
    -- forking user's id here.
    curator_id      UUID REFERENCES users(id) ON DELETE SET NULL,

    estimated_weeks SMALLINT NOT NULL DEFAULT 4 CHECK (estimated_weeks BETWEEN 1 AND 52),
    difficulty      TEXT NOT NULL DEFAULT 'medium'
                    CHECK (difficulty IN ('easy', 'medium', 'hard')),

    is_curated      BOOLEAN NOT NULL DEFAULT TRUE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    -- Tag arrays for the catalogue filter chips. Keep them as TEXT[]
    -- (not enums) so admins can add new tags without a migration.
    tags            TEXT[] NOT NULL DEFAULT '{}'::text[],
    company_focus   TEXT[] NOT NULL DEFAULT '{}'::text[],

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tracks_active_idx ON tracks (is_active);

-- track_steps — one row per ordered step inside a track.
--
-- required_kind values:
--   'kata'        — solve N daily kata in atlas section
--   'arena'       — finish N arena matches (any mode in 1v1)
--   'mock'        — finish N mock pipelines for the matching skill
--   'codex_read'  — open M codex articles tagged with the skill
-- The orchestrator (Phase 2d) reads existing tables (focus_sessions,
-- mock_sessions, codex_article_opens) — there is no per-step write row.
CREATE TYPE track_step_kind AS ENUM ('kata', 'arena', 'mock', 'codex_read', 'focus_block');

CREATE TABLE track_steps (
    track_id           UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    step_index         SMALLINT NOT NULL CHECK (step_index >= 0),
    title              TEXT NOT NULL,
    description_md     TEXT NOT NULL DEFAULT '',
    skill_keys         TEXT[] NOT NULL DEFAULT '{}'::text[],
    required_kind      track_step_kind NOT NULL,
    required_count     INT NOT NULL DEFAULT 1 CHECK (required_count > 0),
    recommended_reading TEXT[] NOT NULL DEFAULT '{}'::text[],
    estimated_minutes  INT NOT NULL DEFAULT 25,
    PRIMARY KEY (track_id, step_index)
);

CREATE INDEX track_steps_skill_idx ON track_steps USING GIN (skill_keys);

-- user_tracks — enrolment row. current_step is 0-based; when current_step
-- reaches len(track_steps) we set completed_at.
--
-- Pause semantics: paused_at is informational only — coach reads it to
-- soften "track stalled" insights into "you paused this on N". A
-- paused track still counts in ListUserTracks; UI greys it out.
CREATE TABLE user_tracks (
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id     UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_step SMALLINT NOT NULL DEFAULT 0,
    -- progress jsonb keyed by step_index (string). Values look like
    --   {"kata_done": 3, "arena_done": 0, "last_action_at": "..."}
    -- Schema is intentionally untyped — readers tolerate missing keys.
    progress     JSONB NOT NULL DEFAULT '{}'::jsonb,
    paused_at    TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, track_id)
);

CREATE INDEX user_tracks_user_active_idx
    ON user_tracks (user_id)
    WHERE completed_at IS NULL;

-- +goose StatementEnd


-- ── from 00008_tracks_seed.sql ──
-- +goose StatementBegin

-- 00008_tracks_seed.sql
--
-- Initial curated catalogue. Five tracks designed to cover the most
-- common reasons a user opens the app:
--
--   algorithms-full-cycle  — classic interview-grind, 12 weeks
--   system-design-from-zero — 10 weeks ramp, lots of codex reads
--   senior-backend-pack    — short, mock-heavy, 8 weeks
--   mock-marathon-7        — 5 mocks in 7 days, intensive
--   yandex-backend-prep    — company-focused, 6 weeks
--
-- Skill_keys reference Atlas node keys (skill_nodes.node_key). When the
-- atlas seed grows, new tracks just append rows here.

INSERT INTO tracks (slug, name, tagline, description_md, accent_color,
                    estimated_weeks, difficulty, is_curated, tags, company_focus)
VALUES
  ('algorithms-full-cycle',
   'Algorithms · полный цикл',
   '12 недель алгоритмической формы',
   'BFS / DFS / DP / strings / graphs / advanced. Каждую неделю — 5 кат + одна дуэль в Arena. AI-coach отслеживает прогресс по weak topics.',
   '#FFFFFF', 12, 'medium', TRUE,
   ARRAY['algorithms', 'core'], ARRAY[]::text[]),

  ('system-design-from-zero',
   'System Design с нуля',
   'От load balancing до consistency',
   'Caching strategies → consistency → sharding → distributed systems. Каждая секция — codex-чтение + sysdesign-mock в конце недели.',
   '#FFFFFF', 10, 'hard', TRUE,
   ARRAY['system_design', 'core'], ARRAY[]::text[]),

  ('senior-backend-pack',
   'Senior Backend Interview Pack',
   'Алго + sys-design + behavioral за 8 недель',
   'Сбалансированная программа: 2 mock-собеса в неделю с AI-судьёй, micro-чтения в Codex по слабым темам, weekly readiness-replay.',
   '#FFFFFF', 8, 'hard', TRUE,
   ARRAY['mocks', 'cross-section'], ARRAY[]::text[]),

  ('mock-marathon-7',
   'Mock Marathon · 5 за 7 дней',
   'Жёсткий интенсив перед собесом',
   'Один mock pipeline в день в течение 5 дней, разбор в day 6, отдых 7. Под крайний дедлайн (interview через 1-2 недели).',
   '#FFFFFF', 1, 'hard', TRUE,
   ARRAY['mocks', 'intensive'], ARRAY[]::text[]),

  ('yandex-backend-prep',
   'Yandex Backend Prep',
   'Целево под Yandex L4-L5',
   '6 недель: HR → algo (Yandex-style) → coding (Go + SQL) → sys-design (cache, consistency) → behavioral. Mocks с Yandex persona, codex-pre-reads под каждую секцию.',
   '#FFFFFF', 6, 'hard', TRUE,
   ARRAY['mocks', 'company-focused'], ARRAY['yandex']);

-- track_steps — заполняем по 5-12 шагов на каждый трек. Скил-ключи
-- ссылаются на узлы Atlas; для треков-под-компании оставляем
-- ARRAY[]::text[] когда шаг pure-mock без конкретной skill-привязки.

-- algorithms-full-cycle (12 шагов).
INSERT INTO track_steps (track_id, step_index, title, description_md, skill_keys,
                         required_kind, required_count, estimated_minutes)
SELECT t.id, x.step_index, x.title, x.description_md, x.skill_keys,
       x.required_kind::track_step_kind, x.required_count, x.estimated_minutes
  FROM tracks t,
       (VALUES
         (0, 'Two pointers + sliding window', 'Базовые ленточные паттерны.', ARRAY['two-pointers'], 'kata', 5, 25),
         (1, 'Hashmap drills', 'Индексация, group-by, dedup.', ARRAY['hashmap'], 'kata', 4, 25),
         (2, 'BFS + DFS', 'Обход графа, посещение, backtracking.', ARRAY['bfs', 'dfs'], 'kata', 6, 30),
         (3, 'Topological sort', 'DAG, уровни, dependency resolution.', ARRAY['topological-sort'], 'kata', 3, 25),
         (4, 'Heap / priority queue', 'Top-K, merge-K, kth-element.', ARRAY['heap'], 'kata', 4, 25),
         (5, 'Binary search', 'Linear → bisect, lower/upper bound.', ARRAY['binary-search'], 'kata', 5, 25),
         (6, 'Dynamic programming · easy', 'Climbing stairs, coin change.', ARRAY['dp'], 'kata', 4, 30),
         (7, 'Dynamic programming · medium', 'Knapsack, LCS, edit distance.', ARRAY['dp'], 'kata', 4, 30),
         (8, 'Strings · KMP / Z', 'Substring matching, периодичность.', ARRAY['strings'], 'kata', 3, 30),
         (9, 'Graphs · advanced', 'Dijkstra, Bellman-Ford, MST.', ARRAY['graphs'], 'kata', 4, 30),
         (10, 'Mock — algo only', 'Один арена-матч 1v1 для калибровки.', ARRAY['algorithms'], 'arena', 1, 45),
         (11, 'Mock — full pipeline', 'Полный mock-pipeline ↦ дебриф.', ARRAY['algorithms'], 'mock', 1, 90)
       ) AS x(step_index, title, description_md, skill_keys, required_kind, required_count, estimated_minutes)
 WHERE t.slug = 'algorithms-full-cycle';

-- system-design-from-zero (10 шагов).
INSERT INTO track_steps (track_id, step_index, title, description_md, skill_keys,
                         required_kind, required_count, estimated_minutes)
SELECT t.id, x.step_index, x.title, x.description_md, x.skill_keys,
       x.required_kind::track_step_kind, x.required_count, x.estimated_minutes
  FROM tracks t,
       (VALUES
         (0, 'Read · networking primer', 'TCP, HTTP, latency budget.', ARRAY['networking'], 'codex_read', 2, 30),
         (1, 'Read · caching strategies', 'Read-through, write-through, write-back.', ARRAY['cache-design'], 'codex_read', 2, 30),
         (2, 'Read · consistency models', 'Strong, eventual, RYW.', ARRAY['consistency'], 'codex_read', 2, 35),
         (3, 'Read · sharding', 'Range, hash, consistent hashing.', ARRAY['sharding'], 'codex_read', 2, 35),
         (4, 'Read · queues + streams', 'At-least-once, exactly-once, ordering.', ARRAY['queues'], 'codex_read', 2, 30),
         (5, 'Drill · capacity estimation', 'Back-of-envelope drills.', ARRAY['capacity-estimation'], 'kata', 3, 30),
         (6, 'Drill · API + storage tradeoffs', 'REST vs GraphQL vs gRPC, RDBMS vs DDB.', ARRAY['api-design'], 'focus_block', 1, 60),
         (7, 'Mock · sysdesign easy', 'TinyURL / rate limiter уровень.', ARRAY['system_design'], 'mock', 1, 60),
         (8, 'Mock · sysdesign medium', 'News feed / chat уровень.', ARRAY['system_design'], 'mock', 1, 75),
         (9, 'Mock · sysdesign hard', 'Web crawler / distributed cache.', ARRAY['system_design'], 'mock', 1, 90)
       ) AS x(step_index, title, description_md, skill_keys, required_kind, required_count, estimated_minutes)
 WHERE t.slug = 'system-design-from-zero';

-- senior-backend-pack (8 шагов).
INSERT INTO track_steps (track_id, step_index, title, description_md, skill_keys,
                         required_kind, required_count, estimated_minutes)
SELECT t.id, x.step_index, x.title, x.description_md, x.skill_keys,
       x.required_kind::track_step_kind, x.required_count, x.estimated_minutes
  FROM tracks t,
       (VALUES
         (0, 'Algo refresher', 'Top-3 weak topics из Atlas.', ARRAY['algorithms'], 'kata', 6, 30),
         (1, 'Mock — algo + coding', 'Hardcore-режим, AI-судья.', ARRAY['algorithms'], 'mock', 1, 75),
         (2, 'Read · sysdesign tradeoffs', 'Caching + consistency + sharding.', ARRAY['system_design'], 'codex_read', 3, 60),
         (3, 'Mock — sysdesign', 'Один полный sysdesign-mock.', ARRAY['system_design'], 'mock', 1, 75),
         (4, 'Behavioral prep', 'STAR-stories, leadership principles.', ARRAY['behavioral'], 'codex_read', 2, 30),
         (5, 'Mock — behavioral', 'Один полный behavioral mock.', ARRAY['behavioral'], 'mock', 1, 45),
         (6, 'Mock — full pipeline', 'Связка всех секций.', ARRAY['mocks'], 'mock', 1, 120),
         (7, 'Replay + readiness', 'Просмотр AI-debrief, фикс weak_topics.', ARRAY[]::text[], 'focus_block', 1, 45)
       ) AS x(step_index, title, description_md, skill_keys, required_kind, required_count, estimated_minutes)
 WHERE t.slug = 'senior-backend-pack';

-- mock-marathon-7 (7 шагов на 7 дней).
INSERT INTO track_steps (track_id, step_index, title, description_md, skill_keys,
                         required_kind, required_count, estimated_minutes)
SELECT t.id, x.step_index, x.title, x.description_md, x.skill_keys,
       x.required_kind::track_step_kind, x.required_count, x.estimated_minutes
  FROM tracks t,
       (VALUES
         (0, 'Day 1 · screening', 'Лёгкий разогревочный mock.', ARRAY['hr'], 'mock', 1, 60),
         (1, 'Day 2 · algo', 'Чистый алго-mock.', ARRAY['algorithms'], 'mock', 1, 75),
         (2, 'Day 3 · coding', 'Go + SQL practical.', ARRAY['coding'], 'mock', 1, 75),
         (3, 'Day 4 · sysdesign', 'Один sysdesign-mock.', ARRAY['system_design'], 'mock', 1, 75),
         (4, 'Day 5 · behavioral', 'Behavioral mock.', ARRAY['behavioral'], 'mock', 1, 45),
         (5, 'Day 6 · debrief', 'Просмотр всех 5 reports подряд, takeaways.', ARRAY[]::text[], 'focus_block', 1, 60),
         (6, 'Day 7 · rest', 'Активный отдых, лёгкая kata, без mocks.', ARRAY['core'], 'kata', 1, 25)
       ) AS x(step_index, title, description_md, skill_keys, required_kind, required_count, estimated_minutes)
 WHERE t.slug = 'mock-marathon-7';

-- yandex-backend-prep (6 шагов).
INSERT INTO track_steps (track_id, step_index, title, description_md, skill_keys,
                         required_kind, required_count, estimated_minutes)
SELECT t.id, x.step_index, x.title, x.description_md, x.skill_keys,
       x.required_kind::track_step_kind, x.required_count, x.estimated_minutes
  FROM tracks t,
       (VALUES
         (0, 'HR-screening', 'Базовый рассказ, мотивация, вилка.', ARRAY['hr'], 'mock', 1, 30),
         (1, 'Algo · Yandex pool', 'Yandex-style сложности.', ARRAY['algorithms'], 'kata', 8, 30),
         (2, 'Coding · Go + SQL', 'Yandex coding-раунд.', ARRAY['coding'], 'mock', 1, 75),
         (3, 'Sysdesign · cache + consistency', 'Yandex акцент на cache.', ARRAY['cache-design', 'consistency'], 'mock', 1, 90),
         (4, 'Behavioral · Yandex values', 'Скорость, hands-on, результат.', ARRAY['behavioral'], 'mock', 1, 45),
         (5, 'Final mock · full pipeline', 'Все 5 секций под Yandex persona.', ARRAY['mocks'], 'mock', 1, 180)
       ) AS x(step_index, title, description_md, skill_keys, required_kind, required_count, estimated_minutes)
 WHERE t.slug = 'yandex-backend-prep';

-- +goose StatementEnd


-- ── from 00009_english_atlas_seed.sql ──
-- +goose StatementBegin

-- 00009_english_atlas_seed.sql
--
-- English-track Atlas seed (Wave 1 of docs/feature/english.md). Adds
-- ~15 atlas_nodes under track_kind='english' / section='english_hr',
-- organised into 4 branches: Reading / Listening / Writing / Speaking.
--
-- Why a seed migration (not admin-CMS): English is the first non-engineering
-- track and the Atlas catalogue is the prerequisite for every other Wave 1
-- piece (mock-round, Insights widget, frontend track-aware Atlas page).
-- We need it materialised in DB so generated UCs read non-empty for QA.
-- Admin CMS can add more nodes later — this is the floor.
--
-- IDs use 'eng_' prefix to avoid collisions with engineering nodes
-- ('algo_basics', 'sql_perf', etc.). cluster column tracks the branch
-- so the Atlas page can group by it.
--
-- track_kind column was added in 00007_skill_atlas_tracks.sql; we set
-- it explicitly per row instead of relying on the default 'dev'.
--
-- sort_order range 200-299 is reserved for English (engineering uses
-- 0-50). Reserves 300-399 for sysanalyst, 400-499 for product analyst.
--
-- Free of edges that cross into engineering tracks — English is its own
-- subgraph. If we ever want "English tech-vocab" to read from sd_basics
-- nodes, that's a Phase-2 concern.

INSERT INTO atlas_nodes (id, title, section, kind, cluster, description, total_count, sort_order, track_kind) VALUES
    -- Hub
    ('eng_root',         'English',                  'english_hr', 'hub',      'english',   'Точка входа в English-трек',                            0, 200, 'english'),

    -- Reading branch
    ('eng_reading',      'Reading',                  'english_hr', 'keystone', 'reading',   'Чтение: художка + tech-литература + статьи',           0, 210, 'english'),
    ('eng_read_fiction', 'Reading: fiction',         'english_hr', 'small',    'reading',   'Художественная проза, narrative voice, vocab range',   0, 211, 'english'),
    ('eng_read_tech',    'Reading: tech',            'english_hr', 'small',    'reading',   'Tech-блоги, доки, архитектурные статьи',                0, 212, 'english'),
    ('eng_read_news',    'Reading: news / journal',  'english_hr', 'small',    'reading',   'Новости, журналистика, idiomatic phrasing',            0, 213, 'english'),

    -- Listening branch
    ('eng_listening',    'Listening',                'english_hr', 'keystone', 'listening', 'Аудио: подкасты + tech-talks + диалоги',                0, 220, 'english'),
    ('eng_listen_pods',  'Listening: podcasts',      'english_hr', 'small',    'listening', 'Native-speed подкасты, slow→native прогрессия',         0, 221, 'english'),
    ('eng_listen_tech',  'Listening: tech-talks',    'english_hr', 'small',    'listening', 'Conf-talks, technical interviews, screen recordings',   0, 222, 'english'),
    ('eng_listen_conv',  'Listening: conversations', 'english_hr', 'small',    'listening', 'Casual conversations, accent diversity, fillers',       0, 223, 'english'),

    -- Writing branch
    ('eng_writing',      'Writing',                  'english_hr', 'keystone', 'writing',   'Письмо: summaries + tech-writing + casual',             0, 230, 'english'),
    ('eng_write_summ',   'Writing: summaries',       'english_hr', 'small',    'writing',   'Конспекты прочитанного, paraphrasing, key-idea capture',0, 231, 'english'),
    ('eng_write_tech',   'Writing: tech-writing',    'english_hr', 'small',    'writing',   'Технические письма, RFC-стиль, design docs',           0, 232, 'english'),
    ('eng_write_casual', 'Writing: casual / email',  'english_hr', 'small',    'writing',   'Email, Slack, разговорный регистр',                     0, 233, 'english'),

    -- Speaking branch
    ('eng_speaking',     'Speaking',                 'english_hr', 'notable',  'speaking',  'Речь: self-recording + mock + tutor',                   0, 240, 'english'),
    ('eng_speak_mock',   'Speaking: mock interviews','english_hr', 'small',    'speaking',  'AI mock HR-rounds (clarity, accuracy, range, fluency)', 0, 241, 'english'),
    ('eng_speak_tutor',  'Speaking: tutor sessions', 'english_hr', 'small',    'speaking',  'Логирование сессий с реальным тутром',                  0, 242, 'english')
ON CONFLICT (id) DO NOTHING;

INSERT INTO atlas_edges (from_id, to_id) VALUES
    -- Hub → 4 branches
    ('eng_root', 'eng_reading'),
    ('eng_root', 'eng_listening'),
    ('eng_root', 'eng_writing'),
    ('eng_root', 'eng_speaking'),
    -- Reading sub-skills
    ('eng_reading', 'eng_read_fiction'),
    ('eng_reading', 'eng_read_tech'),
    ('eng_reading', 'eng_read_news'),
    -- Listening sub-skills
    ('eng_listening', 'eng_listen_pods'),
    ('eng_listening', 'eng_listen_tech'),
    ('eng_listening', 'eng_listen_conv'),
    -- Writing sub-skills
    ('eng_writing', 'eng_write_summ'),
    ('eng_writing', 'eng_write_tech'),
    ('eng_writing', 'eng_write_casual'),
    -- Speaking sub-skills
    ('eng_speaking', 'eng_speak_mock'),
    ('eng_speaking', 'eng_speak_tutor')
ON CONFLICT (from_id, to_id) DO NOTHING;

-- +goose StatementEnd


-- ── from 00010_lobby_skill_filter.sql ──
-- +goose StatementBegin

-- 00010_lobby_skill_filter.sql
--
-- Phase 2c-2 — solo-lobby support + skill-filtered task picker.
--
-- Three things ship together because they're a single feature surface:
--
--   1. lobbies.skill_filter — TEXT[] списком Atlas-узлов (skill_keys),
--      по которым solo-lobby ограничивает выбор задачи. Пустой массив =
--      без фильтра, fallback на section/difficulty.
--
--   2. lobbies CHECK constraints обновлены:
--      - mode добавляет 'solo' (раньше {1v1, 2v2}; 2v2 retired Phase 1.7
--        но строки могли остаться в БД).
--      - max_members BETWEEN 1 AND 4 (раньше 2..4 — solo требует 1).
--
--   3. tasks.skill_keys — TEXT[] для GIN-индекса. Solo task picker делает
--      `WHERE skill_keys && lobby.skill_filter`. Существующие row'ы по
--      умолчанию пустые: пока кураторы не разметят, fallback срабатывает
--      и solo lobby с filter'ом получит ту же задачу что и 1v1 lobby.
--      Это ОК — feature degradades gracefully вместо 404.

ALTER TABLE lobbies
    ADD COLUMN skill_filter TEXT[] NOT NULL DEFAULT '{}';

-- Replace mode CHECK to permit 'solo'.
ALTER TABLE lobbies DROP CONSTRAINT IF EXISTS lobbies_mode_valid;
ALTER TABLE lobbies
    ADD CONSTRAINT lobbies_mode_valid CHECK (mode IN ('1v1', '2v2', 'solo'));

-- Replace max_members range to allow 1 (solo).
ALTER TABLE lobbies DROP CONSTRAINT IF EXISTS lobbies_max_members_range;
ALTER TABLE lobbies
    ADD CONSTRAINT lobbies_max_members_range CHECK (max_members BETWEEN 1 AND 4);

-- tasks.skill_keys — задачам нужны Atlas-узлы для skill-filtered pickup'а.
-- Default пустой → не сбивает существующие seed'ы; куратор может выставить
-- через admin UI / SQL update.
ALTER TABLE tasks
    ADD COLUMN skill_keys TEXT[] NOT NULL DEFAULT '{}'::text[];

-- GIN-индекс для && / @> — task picker делает существенный hot-read.
CREATE INDEX IF NOT EXISTS idx_tasks_skill_keys_gin
    ON tasks USING GIN (skill_keys)
    WHERE is_active;

-- +goose StatementEnd


-- ── from 00011_senior_atlas_seed.sql ──
-- +goose StatementBegin

-- 00011_senior_atlas_seed.sql
--
-- Wave 3 of docs/feature/plan.md — Senior dev pack Atlas seed. Adds
-- ~15 atlas_nodes under track_kind='dev_senior' organised into two
-- branches: System Design depth + Tech Lead / People skills.
--
-- Why a seed migration (vs admin-CMS):
--   * dev_senior is a new persona track with no existing catalogue —
--     we need a non-empty floor for QA + design-partner demos before
--     admin even knows what to edit.
--   * Mirrors 00009_english_atlas_seed.sql (English) and the engineering
--     baseline (00001) — keeps the catalogue's "first cut" reproducible
--     across DB rebuilds.
--
-- IDs use 'sd_' for System Design and 'tl_' for Tech Lead, scoped to
-- the senior track. cluster groups them visually on the Atlas page.
--
-- sort_order range 500-599 reserved for dev_senior. Engineering
-- baseline uses 0-50; English (00009) uses 200-299; this leaves room
-- for sysanalyst (300-399), product analyst (400-499) without renumbering.
--
-- Sections:
--   * 'system_design' for SD nodes — reuses the existing engineering
--     section so SD-specific tools (sysdesign-judge, BuildSysDesign
--     Critique LLM task) keep working without further branching.
--   * 'behavioral' for Tech Lead nodes — closest existing section;
--     people-skills are graded over a behavioral rubric.

INSERT INTO atlas_nodes (id, title, section, kind, cluster, description, total_count, sort_order, track_kind) VALUES
    -- ─── System Design depth (5 sub-skills + branch hub) ───
    ('sd_senior_root',     'System Design (senior)',     'system_design', 'hub',      'system_design', 'Точка входа в SD-трек senior-уровня',                  0, 500, 'dev_senior'),
    ('sd_distributed',     'Distributed systems',        'system_design', 'keystone', 'system_design', 'Consistency, sharding, replication, consensus',         0, 501, 'dev_senior'),
    ('sd_realtime',        'Real-time / streaming',      'system_design', 'notable',  'system_design', 'Pub/sub, Kafka, WebSocket fan-out, backpressure',       0, 502, 'dev_senior'),
    ('sd_ml_systems',      'ML systems',                 'system_design', 'notable',  'system_design', 'Feature stores, online inference, drift monitoring',    0, 503, 'dev_senior'),
    ('sd_security',        'Security & threat model',    'system_design', 'small',    'system_design', 'Auth flows, secret mgmt, SSRF, prompt injection',       0, 504, 'dev_senior'),
    ('sd_observability',   'Observability & SLO',        'system_design', 'small',    'system_design', 'Metrics, tracing, SLO/SLI design, on-call rotation',    0, 505, 'dev_senior'),

    -- ─── Tech Lead / People skills (5 sub-skills + branch hub) ───
    ('tl_root',            'Tech Lead / EM',             'behavioral',    'keystone', 'tech_lead',     'People-leadership мокаемые кейсы для senior+',         0, 510, 'dev_senior'),
    ('tl_one_on_one',      '1:1s + underperformer',      'behavioral',    'notable',  'tech_lead',     'Постановка expectations, perf-conversation cadence',    0, 511, 'dev_senior'),
    ('tl_conflict',        'Conflict resolution',        'behavioral',    'small',    'tech_lead',     'Между разработчиками; с PM; с stakeholder',             0, 512, 'dev_senior'),
    ('tl_tradeoffs',       'Tech-debt vs feature',       'behavioral',    'small',    'tech_lead',     'Defending refactor budget, ROI articulation',           0, 513, 'dev_senior'),
    ('tl_hiring',          'Hiring decisions',           'behavioral',    'small',    'tech_lead',     'Loop calibration, junior-vs-senior tradeoff',           0, 514, 'dev_senior'),
    ('tl_pushback',        'PM/stakeholder pushback',    'behavioral',    'small',    'tech_lead',     'Defending a deadline change; saying no with data',      0, 515, 'dev_senior'),

    -- ─── Code-review-coaching (placeholder for Wave 3.6) ───
    ('crv_root',           'Code review craft',          'behavioral',    'notable',  'code_review',   'Анализ открытых PR с эталонным консенсусом мейнтейнеров', 0, 520, 'dev_senior')
ON CONFLICT (id) DO NOTHING;

INSERT INTO atlas_edges (from_id, to_id) VALUES
    -- SD branch
    ('sd_senior_root', 'sd_distributed'),
    ('sd_senior_root', 'sd_realtime'),
    ('sd_senior_root', 'sd_ml_systems'),
    ('sd_senior_root', 'sd_security'),
    ('sd_senior_root', 'sd_observability'),

    -- Tech Lead branch
    ('tl_root', 'tl_one_on_one'),
    ('tl_root', 'tl_conflict'),
    ('tl_root', 'tl_tradeoffs'),
    ('tl_root', 'tl_hiring'),
    ('tl_root', 'tl_pushback'),

    -- Cross-link from baseline System Design hub into senior depth.
    -- Lets graduates of the engineering SD path see the senior tree
    -- as a natural next step rather than a parallel universe.
    ('sd_basics', 'sd_senior_root'),
    ('sd_scale',  'sd_senior_root')
ON CONFLICT (from_id, to_id) DO NOTHING;

-- +goose StatementEnd


-- ── from 00011_user_goals.sql ──
-- +goose StatementBegin

-- 00011_user_goals.sql
--
-- Phase 4.3 — goal-aware coach briefs.
--
-- user_goals — лёгкая таблица персональных целей юзера, которые coach
-- использует как high-level контекст. Три kind'а:
--   job_target    — «Yandex L4 backend» (карьерная цель, может иметь
--                    deadline = expected interview date / decision date).
--   skill_target  — «Освоить системный дизайн до уровня L4» (без жёсткого
--                    deadline'а, но с self-review milestone'ами).
--   track_target  — «Закончить Algorithms-Full-Cycle к концу мая»
--                    (привязка к learning track из Phase 2).
--
-- Schema choices:
--   - status enum: active / paused / done / abandoned. Coach видит только
--     active; paused — юзер сам пометил «не сейчас», abandoned — ушло
--     в архив.
--   - deadline NULLABLE: skill_target часто не имеет жёсткой даты.
--   - track_id NULLABLE FK на tracks(id) для track_target. ON DELETE
--     SET NULL — если трек удалён из каталога, цель не сносим, coach
--     просто перестаёт привязывать narrative к нему.
--   - notes_md — свободный markdown, юзер пишет «зачем» / progress.

CREATE TYPE user_goal_kind AS ENUM ('job_target', 'skill_target', 'track_target');
CREATE TYPE user_goal_status AS ENUM ('active', 'paused', 'done', 'abandoned');

CREATE TABLE user_goals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         user_goal_kind   NOT NULL,
    status       user_goal_status NOT NULL DEFAULT 'active',
    title        TEXT NOT NULL,
    notes_md     TEXT NOT NULL DEFAULT '',
    deadline     DATE,
    track_id     UUID REFERENCES tracks(id) ON DELETE SET NULL,
    skill_keys   TEXT[] NOT NULL DEFAULT '{}'::text[],
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

-- Hot read: coach pulls active goals on every brief.
CREATE INDEX idx_user_goals_user_active ON user_goals(user_id, deadline NULLS LAST)
    WHERE status = 'active';

-- For deadline-approach severity scan we want a window-based read.
CREATE INDEX idx_user_goals_deadline ON user_goals(deadline)
    WHERE status = 'active' AND deadline IS NOT NULL;

-- +goose StatementEnd


-- ── from 00012_clubs.sql ──
-- +goose StatementBegin

-- 00012_clubs.sql — Phase 3 (Circles → Clubs).
--
-- Clubs — структурированная витрина TG-mirror'a внутри circles.
-- Каждый club живёт под одним circle (FK), но имеет свою curriculum +
-- расписание + curator + ленту sessions с pre-read / recording /
-- takeaways. Это распределяет content production между curators и
-- даёт юзерам понять «когда / о чём / нужно ли готовиться».
--
-- 4 таблицы:
--   clubs            — top-level: одна row на клуб (slug + curator + curriculum).
--   club_sessions    — лента: одна row на встречу (date + topic + materials).
--   club_materials   — артефакты сессии (slides, code, links).
--   club_attendees   — RSVP + post-session notes per-user.
--
-- Status enum:
--   sessions: scheduled / live / done / cancelled
--   attendees: rsvp_yes / rsvp_no / attended / no_show
--
-- Public visibility (clubs.is_public): когда true — видно
-- неавторизованным юзерам (хочется лендинг для виральности). False —
-- видят только members своего circle.

CREATE TYPE club_session_status AS ENUM ('scheduled', 'live', 'done', 'cancelled');
CREATE TYPE club_attendee_status AS ENUM ('rsvp_yes', 'rsvp_no', 'attended', 'no_show');

CREATE TABLE clubs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id         UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    slug              TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    topic_tag         TEXT NOT NULL DEFAULT '',
    curator_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    curriculum_md     TEXT NOT NULL DEFAULT '',
    schedule_kind     TEXT NOT NULL DEFAULT '',  -- "weekly" / "biweekly" / "ad-hoc"
    default_zoom_link TEXT NOT NULL DEFAULT '',
    tg_anchor_url     TEXT NOT NULL DEFAULT '',
    cover_image_url   TEXT NOT NULL DEFAULT '',
    is_public         BOOLEAN NOT NULL DEFAULT FALSE,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clubs_circle ON clubs(circle_id) WHERE is_active;
CREATE INDEX idx_clubs_public ON clubs(is_active, created_at DESC) WHERE is_public AND is_active;

CREATE TABLE club_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id             UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    scheduled_at        TIMESTAMPTZ NOT NULL,
    duration_min        INT NOT NULL DEFAULT 60,
    topic_title         TEXT NOT NULL,
    topic_md            TEXT NOT NULL DEFAULT '',
    presenter_handle    TEXT NOT NULL DEFAULT '',
    zoom_link           TEXT NOT NULL DEFAULT '',
    tg_post_url         TEXT NOT NULL DEFAULT '',
    recording_url       TEXT NOT NULL DEFAULT '',
    pre_read_md         TEXT NOT NULL DEFAULT '',
    summary_md          TEXT NOT NULL DEFAULT '',
    takeaways_md        TEXT NOT NULL DEFAULT '',
    status              club_session_status NOT NULL DEFAULT 'scheduled',
    attached_codex_slugs TEXT[] NOT NULL DEFAULT '{}'::text[],
    attached_event_ids   UUID[] NOT NULL DEFAULT '{}'::uuid[],
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_club_sessions_club_time ON club_sessions(club_id, scheduled_at DESC);
CREATE INDEX idx_club_sessions_upcoming
    ON club_sessions(scheduled_at)
 WHERE status = 'scheduled';

CREATE TABLE club_materials (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES club_sessions(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,  -- 'slides' | 'code' | 'link' | 'doc' | 'transcript'
    label       TEXT NOT NULL,
    url         TEXT NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_club_materials_session ON club_materials(session_id, sort_order);

CREATE TABLE club_attendees (
    session_id  UUID NOT NULL REFERENCES club_sessions(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      club_attendee_status NOT NULL DEFAULT 'rsvp_yes',
    notes_md    TEXT NOT NULL DEFAULT '',
    rsvp_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, user_id)
);
CREATE INDEX idx_club_attendees_user ON club_attendees(user_id, rsvp_at DESC);

-- +goose StatementEnd


-- ── from 00012_tutor_relationships.sql ──
-- +goose StatementBegin

-- 00012_tutor_relationships.sql
--
-- Wave 2 of docs/feature/plan.md (tutor as distribution channel) —
-- two tables: invitations and accepted relationships. The flow:
--
--   1. Tutor calls /tutor/invites → creates a row in tutor_invites
--      with a random 8-char code and TTL 30 days.
--   2. Student opens /invite/{code} on the public web → frontend
--      calls /tutor/invites/{code}/accept (authenticated) which
--      creates a row in tutor_students and marks the invite consumed.
--   3. Student's user_persona_tracks remain user-controlled; the
--      tutor sees data via the snapshot aggregator (read-only).
--
-- Why a separate `tutor_students` table (not a tutor_id column on
-- users):
--   * a student can have multiple tutors over time (English-tutor +
--     Math-tutor — Year 2 multi-tutor, but schema must allow now).
--   * deletion semantics: student leaves a tutor → row disappears,
--     user record stays.
--   * audit: started_at lets us measure tutor-driven retention vs
--     self-acquired without joining mock_sessions on a date guess.
--
-- A composite UNIQUE on (tutor_id, student_id) prevents duplicate
-- relationships from a re-invitation that the student accepted twice.

-- Tutors aren't a separate role yet — any user with users.role='user'
-- becomes a tutor by sending their first invite. This avoids a
-- migration on users.role + UI gates; we'll add a dedicated role
-- ('tutor' / 'tutor_pro') later if the access surface grows.

CREATE TABLE IF NOT EXISTS tutor_invites (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tutor_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT         NOT NULL UNIQUE,
    note        TEXT         NOT NULL DEFAULT '',  -- tutor's free-form annotation, e.g. «Маша, English HR»
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ  NOT NULL,
    accepted_by UUID         REFERENCES users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,                       -- tutor-cancelled before student accepts
    CONSTRAINT tutor_invites_code_format CHECK (char_length(code) BETWEEN 6 AND 32)
);

-- Active-invite lookup by code is the hot read path on every
-- /invite/{code} landing — partial index keeps it tight.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_invites_code_active
    ON tutor_invites (code)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Tutor's invite list — most-recent-first.
CREATE INDEX IF NOT EXISTS idx_tutor_invites_tutor_created
    ON tutor_invites (tutor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tutor_students (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tutor_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_id    UUID         REFERENCES tutor_invites(id) ON DELETE SET NULL,
    started_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ended_at     TIMESTAMPTZ,                       -- soft-end; row stays for cohort analytics
    note         TEXT         NOT NULL DEFAULT '',
    CONSTRAINT tutor_students_self_link CHECK (tutor_id <> student_id)
);

-- One active relationship per (tutor, student). A row that was ended
-- doesn't block re-acceptance — caller updates ended_at IS NULL guard
-- in the upsert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_students_active
    ON tutor_students (tutor_id, student_id)
    WHERE ended_at IS NULL;

-- Tutor dashboard list — most-recent-first per tutor.
CREATE INDEX IF NOT EXISTS idx_tutor_students_tutor_started
    ON tutor_students (tutor_id, started_at DESC);

-- Reverse lookup «who is my tutor» — used by the student-side view.
CREATE INDEX IF NOT EXISTS idx_tutor_students_student_started
    ON tutor_students (student_id, started_at DESC);

-- +goose StatementEnd


-- ── from 00013_hone_reading.sql ──
-- +goose StatementBegin

-- 00013_hone_reading.sql
--
-- Wave 4 of docs/feature/english.md — Reading-модуль в Hone.
-- Хранилище материалов, которые юзер загрузил (PDF / EPUB / web-URL),
-- лог reading-сессий поверх них и SRS-очередь vocab.
--
-- Why three tables (vs. one fat hone_reading_state):
--   * materials — long-form content; deduplication по URL имеет смысл
--     (тот же блогпост у разных юзеров — разные строки, но source_url
--     индекс ускоряет «есть ли уже эта статья у меня»).
--   * sessions — append-only audit; analytics-time-bounded запросы
--     (сколько прочитал за неделю) хорошо разделены от read-path
--     материала.
--   * vocab_queue — отдельная горячая таблица для SRS-review (5 мин
--     daily). Не хочется дёргать материалы при каждом review-tick'е.
--
-- Hone domain owns this — все таблицы под `hone_reading_*` prefix.
-- Engineering-only тренажёрные таблицы (ratings, elo_*, tasks) НЕ
-- касаются — Reading это free-form English content, не contest data.
--
-- ── Materials ─────────────────────────────────────────────────────
--
-- source_kind: 'paste' | 'url' | 'pdf' | 'epub'. Сейчас MVP принимает
-- 'paste' (юзер вставляет markdown) и 'url' (фронт fetch'ит через
-- services/documents extractor → backend получает уже текст).
--
-- body_md — само содержимое в markdown. Хранится в DB, не в S3 —
-- средняя статья ~30KB, годовой объём пользователя ~300 KB.
-- Когда vault-storage flag dial up'ируется (>10 MB у юзера) —
-- мигрируем body_md в MinIO, оставляя preview_md в DB.
--
-- total_chars — счётчик для прогресс-бара. Считаем при insert один
-- раз; пересчитывать на каждый рендер не надо.

CREATE TABLE IF NOT EXISTS hone_reading_materials (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_kind  TEXT         NOT NULL,
    source_url   TEXT         NOT NULL DEFAULT '',
    title        TEXT         NOT NULL,
    body_md      TEXT         NOT NULL,
    total_chars  INT          NOT NULL DEFAULT 0,
    archived_at  TIMESTAMPTZ,             -- soft-delete; UI hides, queries ignore
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT hone_reading_source_kind_valid
        CHECK (source_kind IN ('paste','url','pdf','epub')),
    CONSTRAINT hone_reading_total_chars_nonneg
        CHECK (total_chars >= 0)
);

-- Library list — most-recent first per user.
CREATE INDEX IF NOT EXISTS idx_hone_reading_materials_user_active
    ON hone_reading_materials (user_id, created_at DESC)
    WHERE archived_at IS NULL;

-- ── Sessions ─────────────────────────────────────────────────────
--
-- One row per reading «sit». chars_read advances as the user scrolls
-- (frontend reports periodic progress); ended_at is stamped when
-- they close the page or the 25-min timer expires.
--
-- ai_summary_score — optional, 0..100, set by AI summary check after
-- the chapter (Wave 4.3). NULL = not yet graded.

CREATE TABLE IF NOT EXISTS hone_reading_sessions (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    material_id      UUID         NOT NULL REFERENCES hone_reading_materials(id) ON DELETE CASCADE,
    chars_read       INT          NOT NULL DEFAULT 0,
    chars_total      INT          NOT NULL DEFAULT 0,
    started_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ended_at         TIMESTAMPTZ,
    ai_summary_score INT,
    summary_md       TEXT         NOT NULL DEFAULT '',
    CONSTRAINT hone_reading_sessions_score_range
        CHECK (ai_summary_score IS NULL OR (ai_summary_score >= 0 AND ai_summary_score <= 100))
);

CREATE INDEX IF NOT EXISTS idx_hone_reading_sessions_user_started
    ON hone_reading_sessions (user_id, started_at DESC);

-- Per-material session list — used by «materials with progress» card.
CREATE INDEX IF NOT EXISTS idx_hone_reading_sessions_material
    ON hone_reading_sessions (material_id, started_at DESC);

-- ── Vocab queue ─────────────────────────────────────────────────
--
-- SRS state per (user_id, word). Алгоритм — упрощённый SM-2:
--   * box: 0..5 (Leitner-style); 0 = только что добавлено, 5 = mastered.
--   * next_review_at: serves as the «show this card today?» key.
--   * reviewed_count: счётчик для аналитики, не для алгоритма.
--
-- context_md — фраза вокруг слова из материала, чтобы review-карточка
-- показывала «in what sentence did you see it?» (без context vocab
-- учится в 3х хуже).

CREATE TABLE IF NOT EXISTS hone_vocab_queue (
    user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    word             TEXT         NOT NULL,
    translation      TEXT         NOT NULL DEFAULT '',
    context_md       TEXT         NOT NULL DEFAULT '',
    source_material  UUID         REFERENCES hone_reading_materials(id) ON DELETE SET NULL,
    box              SMALLINT     NOT NULL DEFAULT 0,
    next_review_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    reviewed_count   INT          NOT NULL DEFAULT 0,
    learned_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, word),
    CONSTRAINT hone_vocab_box_range CHECK (box BETWEEN 0 AND 5)
);

-- The «what's due today» query — partial idx on the active part of
-- the queue so daily-review hits a tiny index.
CREATE INDEX IF NOT EXISTS idx_hone_vocab_due
    ON hone_vocab_queue (user_id, next_review_at)
    WHERE learned_at IS NULL;

-- +goose StatementEnd


-- ── from 00014_tutor_assignments.sql ──
-- +goose StatementBegin

-- 00014_tutor_assignments.sql
--
-- Wave 5.1 of docs/feature/plan.md (Tutor Tier 2: tutor pushes
-- assignments to a student's Hone Today). Tutor authors a piece of
-- work — a chapter to read, a writing prompt, a mock to take —
-- attached to a specific (tutor, student) pair. Student sees it on
-- the Hone Today surface with `source=from_tutor` styling and can
-- mark it complete; tutor sees the completion timestamp.
--
-- Why a separate table (vs piggybacking on hone_focus_queue or
-- hone_plan_items):
--   * ownership: rows are owned by the tutor who authored them, not
--     the student who consumes them. Cross-user delete cascading
--     differs (deleting the tutor revokes assignments; deleting the
--     student archives them).
--   * lifecycle: an assignment outlives one focus session. Today's
--     plan can show it; tomorrow's plan can show it again until
--     completed_at is stamped.
--   * auth: tutor-side endpoints scope by tutor_id, student-side by
--     student_id. A composite-purpose table forces every callsite
--     to think about both axes; keeping it flat makes the SQL gate
--     trivial («WHERE tutor_id = $1» / «WHERE student_id = $1»).
--
-- An (tutor_id, student_id) row pair MUST exist in tutor_students
-- with ended_at IS NULL at the time of INSERT — enforced at the use
-- case level (EnsureRelationship), not via FK, because relationships
-- are mutable (end + restart) and an FK would force ON DELETE
-- decisions we don't want to bake in.

CREATE TABLE IF NOT EXISTS tutor_assignments (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tutor_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT         NOT NULL,
    body_md       TEXT         NOT NULL DEFAULT '',
    -- Optional «do this by» — when set, Hone Today surfaces it with a
    -- countdown chip. NULL = open-ended (tutor just wants it done «soon»).
    due_at        TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Stamped when the student marks the assignment done. Tutor's view
    -- shows ✓ + the completion delta-from-due as a feedback signal.
    completed_at  TIMESTAMPTZ,
    -- Soft-archive — tutor can withdraw an assignment without losing
    -- the audit trail (e.g. they realised they sent it to the wrong
    -- student or the topic became irrelevant).
    archived_at   TIMESTAMPTZ,
    CONSTRAINT tutor_assignments_self_link CHECK (tutor_id <> student_id),
    CONSTRAINT tutor_assignments_title_nonempty CHECK (char_length(title) > 0)
);

-- Tutor's per-student backlog — most-recent-first; archived rows
-- excluded from the partial index so the dashboard list query is tight.
CREATE INDEX IF NOT EXISTS idx_tutor_assignments_tutor_student_active
    ON tutor_assignments (tutor_id, student_id, created_at DESC)
    WHERE archived_at IS NULL;

-- Student's active list — drives the Hone Today «from_tutor» surface.
-- Excludes completed AND archived so the partial index covers exactly
-- the «show me what to work on» query.
CREATE INDEX IF NOT EXISTS idx_tutor_assignments_student_pending
    ON tutor_assignments (student_id, due_at NULLS LAST, created_at DESC)
    WHERE archived_at IS NULL AND completed_at IS NULL;

-- +goose StatementEnd


-- ── from 00015_hone_listening.sql ──
-- +goose StatementBegin

-- 00015_hone_listening.sql
--
-- Wave 6.1 of docs/feature/plan.md (Listening — transcript over
-- podcasts + click-on-word + speed control). Parallel to Reading-
-- модуль (migration 00013): user-owned library of listening materials
-- where each row carries an audio_url + transcript_md. The user
-- consumes a material in the Hone Listening-page (hotkey L), clicks
-- on words to add them to `hone_vocab_queue` (already exists, Wave 4).
--
-- Why a separate table (vs piggybacking on hone_reading_materials):
--   * audio_url is a top-level concern, not an optional field on a
--     material that's «mostly» text.
--   * transcript_md needs to align tightly with audio playhead — a
--     future enhancement adds [HH:MM] anchor lines that the player
--     auto-scrolls. Reading materials don't have this need.
--   * separate library indices = library views стай tight; user can
--     have 100 articles + 20 podcasts without one cluttering the
--     other.
--
-- No sessions table yet — Listening V1 doesn't track «how much I
-- listened» the way Reading tracks chars_read. If the analytic value
-- materialises we'll add hone_listening_sessions in V2 (parallel to
-- hone_reading_sessions).

CREATE TABLE IF NOT EXISTS hone_listening_materials (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT         NOT NULL,
    -- audio_url: direct-playable URL (mp3, m4a, ogg, etc.) OR file://
    -- local path. YouTube/Spotify etc. are NOT supported by V1's
    -- <audio> player; the frontend rejects unrecognised hosts at
    -- input time so we don't store junk.
    audio_url    TEXT         NOT NULL,
    -- transcript_md: full transcript as markdown. The body is what
    -- the click-on-word vocab pipeline reads; without it, Listening
    -- degrades to a plain audio player with no SRS-feeding power.
    transcript_md TEXT        NOT NULL DEFAULT '',
    -- Soft-delete; library views filter on `archived_at IS NULL`.
    archived_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT hone_listening_title_nonempty CHECK (char_length(title) > 0),
    CONSTRAINT hone_listening_audio_url_nonempty CHECK (char_length(audio_url) > 0)
);

-- Library list — most-recent first per user, active rows only.
CREATE INDEX IF NOT EXISTS idx_hone_listening_materials_user_active
    ON hone_listening_materials (user_id, created_at DESC)
    WHERE archived_at IS NULL;

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- baseline; rollback by dropping the database
-- +goose StatementEnd
