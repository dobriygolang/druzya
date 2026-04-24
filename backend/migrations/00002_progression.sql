-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00002 progression: profiles, ratings, seasons, achievements,
--   atlas catalogue, weekly stats, mentor
-- Consolidated from: 00001 (profiles), 00002 rating_progression,
--   00015 achievements, 00026 weekly_stats, 00028 mentor_profile,
--   00031 atlas_catalogue, 00034 atlas_orbital, 00008 seeds
-- ============================================================

CREATE TABLE profiles (
    user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    char_class          TEXT NOT NULL DEFAULT 'novice',
    level               INT NOT NULL DEFAULT 1,
    xp                  BIGINT NOT NULL DEFAULT 0,
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

CREATE TABLE seasons (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    theme       TEXT,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    is_current  BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX idx_seasons_one_current ON seasons(is_current) WHERE is_current;

CREATE TABLE season_progress (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id   UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    points      INT NOT NULL DEFAULT 0,
    tier        INT NOT NULL DEFAULT 0,
    is_premium  BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, season_id)
);

-- Legacy key-based achievements (row-per-earn)
CREATE TABLE achievements (
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_key  TEXT NOT NULL,
    earned_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, achievement_key)
);

-- Code-based achievements with in-progress tracking
CREATE TABLE user_achievements (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT NOT NULL,
    progress    INT NOT NULL DEFAULT 0,
    target      INT NOT NULL DEFAULT 1,
    unlocked_at TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, code)
);
CREATE INDEX idx_user_ach_user ON user_achievements (user_id, unlocked_at DESC NULLS LAST);

-- ─── atlas (skill tree) ──────────────────────────────────
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
    CONSTRAINT atlas_nodes_kind_valid
        CHECK (kind IN ('hub', 'keystone', 'notable', 'small')),
    CONSTRAINT atlas_nodes_total_nonneg CHECK (total_count >= 0)
);
CREATE INDEX idx_atlas_nodes_active_section
    ON atlas_nodes(section) WHERE is_active = TRUE;
CREATE INDEX idx_atlas_nodes_active_cluster
    ON atlas_nodes(cluster) WHERE is_active = TRUE;

CREATE TABLE atlas_edges (
    id        BIGSERIAL PRIMARY KEY,
    from_id   TEXT NOT NULL REFERENCES atlas_nodes(id) ON DELETE CASCADE,
    to_id     TEXT NOT NULL REFERENCES atlas_nodes(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL DEFAULT 'prereq',
    UNIQUE (from_id, to_id),
    CONSTRAINT atlas_edges_no_self CHECK (from_id <> to_id),
    CONSTRAINT atlas_edges_kind_valid CHECK (kind IN ('prereq', 'suggested', 'crosslink'))
);
CREATE INDEX idx_atlas_edges_to ON atlas_edges(to_id);

-- Seed atlas catalogue. kind values use the post-00034 PoE-inspired vocabulary
-- (hub/keystone/notable/small).  cluster defaults to section at seed time.
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
    ('class_core', 'algo_basics'),
    ('class_core', 'sql_basics'),
    ('class_core', 'go_idioms'),
    ('class_core', 'beh_star'),
    ('class_core', 'sd_basics'),
    ('algo_basics', 'algo_graphs'),
    ('algo_basics', 'algo_dp'),
    ('sql_basics', 'sql_perf'),
    ('go_idioms', 'go_concurrency'),
    ('sd_basics', 'sd_scale')
ON CONFLICT (from_id, to_id) DO NOTHING;

-- ─── weekly stats ─────────────────────────────────────────
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
CREATE INDEX idx_elo_snapshots_user_date
    ON elo_snapshots_daily (user_id, snapshot_date DESC);

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

-- ─── mentor sessions (marketplace scaffold) ───────────────
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
    CONSTRAINT mentor_sessions_distinct_parties
        CHECK (mentee_id <> mentor_id)
);
CREATE INDEX idx_mentor_sessions_mentor ON mentor_sessions(mentor_id, slot_at DESC);
CREATE INDEX idx_mentor_sessions_mentee ON mentor_sessions(mentee_id, slot_at DESC);

-- ─── seed current season ──────────────────────────────────
INSERT INTO seasons(name, slug, theme, starts_at, ends_at, is_current) VALUES
  ('The Awakening', 'season-1', 'awakening',
   now() - interval '2 weeks', now() + interval '4 weeks', TRUE)
ON CONFLICT (slug) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;
-- +goose StatementEnd
