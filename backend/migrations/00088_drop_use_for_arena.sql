-- 00088_drop_use_for_arena: drop llm_models.use_for_arena column.
--
-- Mirrors pattern из 00082_drop_vacancies (drop column + proto reserved
-- + Go code cleanup). Arena RPG-surface удалена 2026-04/05; колонка
-- использовалась только админ-фильтром для arena tier model picker.
--
-- Pre-conditions (выполнены в этой же серии patches):
--   1. proto/druz9/v1/ai_models.proto — field 13 / 14 (has_) reserved
--   2. backend/services/admin/domain/ai_models.go — UseForArena removed
--   3. backend/services/admin/ports/ai_models.go — converter dropped
--   4. backend/services/admin/infra/ai_models_repo.go — SQL/scan/insert/
--      update dropped
--
-- After `make generate` regenerates pb stubs — use_for_arena field
-- больше не присутствует в API.
--
-- Drop is idempotent через IF EXISTS.
BEGIN;

ALTER TABLE llm_models DROP COLUMN IF EXISTS use_for_arena;

COMMIT;

-- +goose Down
-- Restore колонку с default true (legacy seed behavior).
BEGIN;

ALTER TABLE llm_models
  ADD COLUMN IF NOT EXISTS use_for_arena BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
