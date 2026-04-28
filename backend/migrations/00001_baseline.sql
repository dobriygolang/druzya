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
    CONSTRAINT subscriptions_plan_valid     CHECK (plan IN ('free','seeker','ascendant')),
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
    CONSTRAINT llm_models_tier_valid CHECK (tier IN ('free','premium'))
);
CREATE INDEX llm_models_enabled_sort_idx ON llm_models (is_enabled, sort_order);

INSERT INTO llm_models (
    model_id, label, provider, provider_id, tier, is_virtual,
    use_for_arena, use_for_insight, use_for_mock, use_for_vacancies, sort_order
) VALUES
    ('druz9/turbo',                        'Турбо ⚡ (авто-роутинг)',         'druz9',     'druz9',      'free',    TRUE,  TRUE,  TRUE,  TRUE,  TRUE,   1),
    ('openai/gpt-4o-mini',                 'GPT-4o mini',                    'openai',    'openrouter', 'free',    FALSE, TRUE,  TRUE,  TRUE,  TRUE,  10),
    ('qwen/qwen3-coder:free',              'Qwen3 Coder (free)',             'qwen',      'openrouter', 'free',    FALSE, FALSE, TRUE,  FALSE, TRUE,  11),
    ('openai/gpt-oss-120b:free',           'GPT-OSS 120B (free)',            'openai',    'openrouter', 'free',    FALSE, FALSE, TRUE,  FALSE, FALSE, 12),
    ('openai/gpt-4o',                      'GPT-4o',                         'openai',    'openrouter', 'premium', FALSE, TRUE,  TRUE,  TRUE,  FALSE, 30),
    ('anthropic/claude-sonnet-4',          'Claude Sonnet 4',                'anthropic', 'openrouter', 'premium', FALSE, TRUE,  TRUE,  TRUE,  FALSE, 40),
    ('groq/llama-3.3-70b-versatile',       'Llama 3.3 70B (Groq)',           'groq',      'groq',       'free',    FALSE, TRUE,  TRUE,  TRUE,  TRUE,  21),
    ('cerebras/llama3.3-70b',              'Llama 3.3 70B (Cerebras)',       'cerebras',  'cerebras',   'free',    FALSE, TRUE,  TRUE,  TRUE,  TRUE,  31)
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
    models_allowed  TEXT[] NOT NULL DEFAULT ARRAY[
        'druz9/turbo',
        'groq/llama-3.3-70b-versatile',
        'cerebras/llama3.3-70b',
        'openai/gpt-oss-120b:free',
        'qwen/qwen3-coder:free'
    ]::TEXT[],
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT copilot_quotas_plan_valid CHECK (plan IN ('free','seeker','ascendant'))
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
    token_count     INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_doc_chunks_doc ON doc_chunks(doc_id, ord);

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

CREATE TABLE hone_daily_briefs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brief_date      DATE NOT NULL,
    headline        TEXT NOT NULL DEFAULT '',
    narrative_md    TEXT NOT NULL DEFAULT '',
    recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
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

CREATE TABLE mock_pipelines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id  UUID REFERENCES companies(id),
    role_label  TEXT NOT NULL DEFAULT '',
    section     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'created',
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mock_pipelines_status_valid CHECK (status IN ('created','in_progress','finished','abandoned'))
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

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- baseline; rollback by dropping the database
-- +goose StatementEnd
