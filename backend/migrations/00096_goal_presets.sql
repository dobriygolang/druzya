-- 00096_goal_presets.sql — Admin Phase 2: goal presets management.
--
-- Admin-curated goal templates that users могут pick в GoalWizard как
-- quick-start (e.g. "Senior Backend @ Yandex"). Default 8 builtin presets
-- покрывают TOP_TIER_COMPANIES + ML offer + English target + any-senior.
--
-- Mirrors primary_goal_kind enum strings (но stored as TEXT — frontend
-- посылает GOAL_KIND_* directly, admin form picks из dropdown). Hard
-- linking enum'ом не делаем — presets могут пережить enum-эволюцию.
--
-- default_target_days — opt-in: при click'е на preset wizard ставит
-- target_date = now() + N days. NULL = no default date.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE IF NOT EXISTS goal_presets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                TEXT UNIQUE NOT NULL,
    title               TEXT NOT NULL,
    kind                TEXT NOT NULL,
    target_company      TEXT NOT NULL DEFAULT '',
    target_level        TEXT NOT NULL DEFAULT '',
    target_text         TEXT NOT NULL DEFAULT '',
    default_target_days INT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order          INT NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS goal_presets_active
    ON goal_presets(is_active, sort_order);

INSERT INTO goal_presets (slug, title, kind, target_company, default_target_days, sort_order, is_active) VALUES
    ('senior-yandex',  'Senior Backend @ Yandex',      'GOAL_KIND_TOP_TIER_CO',    'Yandex',      90,  10, TRUE),
    ('senior-google',  'Senior Backend @ Google',      'GOAL_KIND_TOP_TIER_CO',    'Google',      120, 20, TRUE),
    ('senior-wb',      'Senior Backend @ Wildberries', 'GOAL_KIND_TOP_TIER_CO',    'Wildberries', 75,  30, TRUE),
    ('senior-ozon',    'Senior Backend @ Ozon',        'GOAL_KIND_TOP_TIER_CO',    'Ozon',        75,  40, TRUE),
    ('senior-tinkoff', 'Senior Backend @ Tinkoff',     'GOAL_KIND_TOP_TIER_CO',    'Tinkoff',     75,  50, TRUE),
    ('ml-faang',       'ML Engineer @ FAANG',          'GOAL_KIND_ML_OFFER',       '',            120, 60, TRUE),
    ('english-toefl',  'TOEFL 100+',                   'GOAL_KIND_ENGLISH_TARGET', '',            90,  70, TRUE),
    ('any-senior',     'Senior at any IT Co',          'GOAL_KIND_ANY_SENIOR',     '',            60,  80, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS goal_presets;

-- +goose StatementEnd
