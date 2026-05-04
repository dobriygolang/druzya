-- 00051_external_resources_schema.sql — Phase 1a из docs/feature/implementation-plan.md.
--
-- Curation principle (memory/project_curation_model): druz9 — ranking-proxy.
-- Theory + practice — линки на чужое (Strang, mlcourse, DDIA, Kaggle, etc.).
-- Кладём в jsonb со shape:
--
--   { url, title, author, kind, minutes, level, priority, why }
--
-- kind: course | video | book | paper | article | tool | kata | podcast
-- level: A | B | C | D
-- priority: core | supplement | optional
--
-- Старая колонка track_steps.recommended_reading TEXT[] — deprecated,
-- но НЕ дропаем сейчас: existing UI/handlers ещё могут читать. Cleanup
-- в Phase 1.5 (bundle delta analysis) определит, когда дропнуть.
--
-- Validation структуры — на app-уровне (services/curation, Phase 1c).
-- jsonb CHECK constraint не делаем: validation evolves, hard schema в БД
-- быстро устареет.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE atlas_nodes
    ADD COLUMN IF NOT EXISTS external_resources JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE track_steps
    ADD COLUMN IF NOT EXISTS external_resources JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN atlas_nodes.external_resources IS 'Curated external resources for this skill (Strang, mlcourse, DDIA, etc.). Shape: array of {url, title, author, kind, minutes, level, priority, why}. See services/curation for validation.';
COMMENT ON COLUMN track_steps.external_resources IS 'Sequence of curated resources to complete this step. Same shape as atlas_nodes.external_resources.';

-- GIN-индекс для будущих фильтров типа «kind=video and minutes < 30».
-- jsonb_path_ops компактнее default ops, но поддерживает только @> —
-- этого достаточно для всех планируемых query patterns.
CREATE INDEX IF NOT EXISTS idx_atlas_nodes_external_resources_gin
    ON atlas_nodes USING GIN (external_resources jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_track_steps_external_resources_gin
    ON track_steps USING GIN (external_resources jsonb_path_ops);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_track_steps_external_resources_gin;
DROP INDEX IF EXISTS idx_atlas_nodes_external_resources_gin;

ALTER TABLE track_steps  DROP COLUMN IF EXISTS external_resources;
ALTER TABLE atlas_nodes  DROP COLUMN IF EXISTS external_resources;
-- +goose StatementEnd
