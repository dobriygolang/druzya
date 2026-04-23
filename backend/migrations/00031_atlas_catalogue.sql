-- +goose Up
-- +goose StatementBegin
--
-- 00031 — Atlas catalogue: admin-editable skill atlas (nodes + edges).
--
-- Replaces the hardcoded `catalogueNodes` / `catalogueEdges` in
-- backend/services/profile/app/atlas.go. The admin CMS now owns the
-- skill tree shape (CRUD on nodes, add/remove edges, optional manual
-- pos_x/pos_y for hand-tuned layout).
--
-- atlas_nodes.id is TEXT (slug-like, e.g. "algo_basics") so existing
-- per-user `skill_nodes.node_key` rows keep matching without migration.
--
-- pos_x/pos_y are nullable: NULL means "let the frontend auto-layout"
-- (the radial-spoke algorithm in AtlasPage.tsx). When set, they become
-- the source of truth and the frontend renders the node at that exact
-- viewBox coordinate (in the 0..1400 system).
--
-- Anti-fallback: seed inserts mirror the previous Go slice EXACTLY so
-- the migration is observably a no-op for existing users — same node
-- ids, titles, sections, kinds, total_counts, edges. Diverging from
-- the existing keys would orphan user progress in skill_nodes.

CREATE TABLE IF NOT EXISTS atlas_nodes (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    section      TEXT NOT NULL,
    kind         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    total_count  INT  NOT NULL DEFAULT 0,
    pos_x        INT,
    pos_y        INT,
    sort_order   INT  NOT NULL DEFAULT 0,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT atlas_nodes_kind_valid
        CHECK (kind IN ('normal','keystone','ascendant','center')),
    CONSTRAINT atlas_nodes_total_nonneg
        CHECK (total_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_atlas_nodes_active_section
    ON atlas_nodes(section)
    WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS atlas_edges (
    id        BIGSERIAL PRIMARY KEY,
    from_id   TEXT NOT NULL REFERENCES atlas_nodes(id) ON DELETE CASCADE,
    to_id     TEXT NOT NULL REFERENCES atlas_nodes(id) ON DELETE CASCADE,
    UNIQUE (from_id, to_id),
    CONSTRAINT atlas_edges_no_self CHECK (from_id <> to_id)
);

CREATE INDEX IF NOT EXISTS idx_atlas_edges_to ON atlas_edges(to_id);

-- ── Seed: mirrors the previous hardcoded catalogue 1:1 ──
-- center node uses kind='center' instead of 'keystone' to let the
-- frontend treat it specially (brand sigil + glow). The existing
-- "class_core" id is preserved so user progress rows match.
INSERT INTO atlas_nodes (id, title, section, kind, description, total_count, sort_order)
VALUES
    ('class_core',     'Ядро класса',                'algorithms',    'center',    'Стартовая точка атласа',                  1,   0),
    ('algo_basics',    'Алгоритмы: основы',          'algorithms',    'normal',    'Массивы, строки, хеш-таблицы',            23, 10),
    ('algo_graphs',    'Алгоритмы: графы',           'algorithms',    'normal',    'DFS/BFS, топосорт, Дейкстра',             18, 11),
    ('algo_dp',        'Алгоритмы: DP',              'algorithms',    'keystone',  'Динамическое программирование',           30, 12),
    ('sql_basics',     'SQL: основы',                'sql',           'normal',    'JOIN, GROUP BY, подзапросы',              14, 20),
    ('sql_perf',       'SQL: производительность',    'sql',           'keystone',  'Индексы, EXPLAIN, денормализация',         9, 21),
    ('go_concurrency', 'Go: concurrency',            'go',            'keystone',  'Горутины, каналы, контексты',             16, 31),
    ('go_idioms',      'Go: идиомы',                 'go',            'normal',    'Интерфейсы, ошибки, дженерики',           12, 30),
    ('sd_basics',      'System Design: основы',      'system_design', 'normal',    'CAP, кэши, очереди',                       8, 40),
    ('sd_scale',       'System Design: масштаб',     'system_design', 'ascendant', 'Шардирование, репликация, consistency',    6, 41),
    ('beh_star',       'Behavioral: STAR',           'behavioral',    'normal',    'Структура ответов на вопросы',            10, 50)
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
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_atlas_edges_to;
DROP TABLE IF EXISTS atlas_edges;
DROP INDEX IF EXISTS idx_atlas_nodes_active_section;
DROP TABLE IF EXISTS atlas_nodes;
-- +goose StatementEnd
