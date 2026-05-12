-- 00091_stage_templates.sql — R7 Phase 1: pipeline-template library.
--
-- Admin Company Manager redesign — quick-start templates (Standard /
-- Yandex / Ozon / PM / blank) so curators не собирают пайплайн вручную
-- каждый раз. `stages_json` хранит готовый список stage entries в той же
-- shape что и POST к /admin/mock/companies/{id}/stages — apply просто
-- замещает текущий config.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE IF NOT EXISTS stage_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    stages_json JSONB NOT NULL DEFAULT '[]',
    usage_count INT NOT NULL DEFAULT 0,
    is_builtin  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stage_templates_builtin_idx
    ON stage_templates (is_builtin, slug);

-- Seed builtin templates. ON CONFLICT keeps re-runs idempotent.
INSERT INTO stage_templates (slug, name, description, stages_json, is_builtin) VALUES
    ('standard-3', 'Standard 3-stage', 'HR → Algo → Behavioral',
        '[{"kind":"hr"},{"kind":"algo"},{"kind":"behavioral"}]'::jsonb, TRUE),
    ('yandex-like', 'Yandex-style', 'Algo + SysDesign + Behavioral',
        '[{"kind":"algo"},{"kind":"sysdesign"},{"kind":"behavioral"}]'::jsonb, TRUE),
    ('ozon-like', 'Ozon-style', 'HR + Coding + Behavioral',
        '[{"kind":"hr"},{"kind":"coding"},{"kind":"behavioral"}]'::jsonb, TRUE),
    ('pm-track', 'Product Manager', 'HR + Behavioral only',
        '[{"kind":"hr"},{"kind":"behavioral"}]'::jsonb, TRUE),
    ('blank', 'Blank', 'Empty starter',
        '[]'::jsonb, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS stage_templates;
-- +goose StatementEnd
