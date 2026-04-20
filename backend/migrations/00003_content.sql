-- +goose Up
-- +goose StatementBegin
CREATE TABLE companies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    difficulty          TEXT NOT NULL,
    min_level_required  INT NOT NULL DEFAULT 0,
    sections            TEXT[] NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT companies_difficulty_valid CHECK (difficulty IN ('normal','hard','boss'))
);

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
    solution_hint   TEXT,                     -- only for AI — never returned to client
    version         INT NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    avg_rating      NUMERIC(3,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tasks_difficulty_valid CHECK (difficulty IN ('easy','medium','hard')),
    CONSTRAINT tasks_section_valid CHECK (section IN ('algorithms','sql','go','system_design','behavioral'))
);

CREATE TABLE test_cases (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    input            TEXT NOT NULL,
    expected_output  TEXT NOT NULL,
    is_hidden        BOOLEAN NOT NULL DEFAULT FALSE,
    order_num        INT NOT NULL DEFAULT 0
);

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

CREATE INDEX idx_tasks_section_diff ON tasks(section, difficulty) WHERE is_active;
CREATE INDEX idx_test_cases_task ON test_cases(task_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS task_ratings;
DROP TABLE IF EXISTS follow_up_questions;
DROP TABLE IF EXISTS task_templates;
DROP TABLE IF EXISTS test_cases;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS companies;
-- +goose StatementEnd
