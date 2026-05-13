-- 00117_hone_tasks_ml_kind.sql — Phase K M7 (2026-05-13) Hone TaskBoard ML kind.
--
-- Wave 6 (Y) shipped ml_coding stage_kind в mock_interview (Phase K M4) +
-- ML companies seed (Google ML / Meta AI / OpenAI / Anthropic / DeepMind /
-- NVIDIA ML / Yandex Cloud ML / Sber Devices / T-Bank AI/ML / Avito ML).
--
-- Hone TaskBoard auto-categorise hook (Wave 2 I, см. backend/services/hone/
-- app/categorise_task.go) сейчас раутит ML/MLE tasks в `custom` или `quiz`
-- bucket — ни один из них не отражает ML-specific нагрузку: paper reading,
-- gradient debugging, MLOps pipeline drafts, fine-tuning experiments. Это
-- ломает kind-filter chip на TaskBoard для ML-track юзеров: они вынуждены
-- либо использовать `custom` (no signal) либо `quiz` (wrong validator —
-- AI-coach treats quiz как Q&A drill, не как hands-on ML work).
--
-- Решение: явный `ml` kind в hone_tasks.kind CHECK constraint. Соответствует
-- TaskKindML в backend/services/hone/domain/task.go + TaskKind enum в
-- proto/druz9/v1/hone.proto + KINDS / ALL_KINDS в hone/src/renderer/src/
-- components/taskboard/kinds.tsx.
--
-- Поведение:
--   • Manual create via UI / chip-picker → kind='ml' доступен.
--   • Auto-categorise LLM prompt (categorise_task.go) расширен с ml-kind
--     keywords (deep learning, gradient, attention, model, dataset,
--     fine-tune, RAG, LoRA, MLOps, training pipeline).
--   • coach_listener валидатор: kind='ml' settle through generic
--     `mock_interview.MockPipelineFinished` event (section=ml_eng /
--     ml_system_design / ml_coding / ml_theory).

-- +goose Up
-- +goose StatementBegin

ALTER TABLE hone_tasks DROP CONSTRAINT IF EXISTS hone_tasks_kind_valid;
ALTER TABLE hone_tasks ADD CONSTRAINT hone_tasks_kind_valid
    CHECK (kind IN ('algo','sysdesign','quiz','reflection','reading','ml','custom'));

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Rollback: revert to original 6-kind set. Any rows with kind='ml' must be
-- migrated to 'custom' first; we do that inline as part of the down step
-- so the new CHECK actually applies.
UPDATE hone_tasks SET kind = 'custom' WHERE kind = 'ml';

ALTER TABLE hone_tasks DROP CONSTRAINT IF EXISTS hone_tasks_kind_valid;
ALTER TABLE hone_tasks ADD CONSTRAINT hone_tasks_kind_valid
    CHECK (kind IN ('algo','sysdesign','quiz','reflection','reading','custom'));

-- +goose StatementEnd
