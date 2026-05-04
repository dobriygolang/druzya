-- 00048_de_track.sql — Phase 1a из docs/feature/implementation-plan.md.
--
-- Добавляет 'de' (data engineering) в track_kind. Atlas seed + curated
-- track-steps — отдельно (00049, 00050), чтобы изолировать enum-rebuild
-- (NO TRANSACTION) от обычных INSERT/UPDATE.
--
-- DE как явный track-kind, не sub-cluster под dev_senior — у DE свой
-- mock-pool (services/ai_mock/domain/de.go, Phase 1c) с 5-axis rubric
-- (etl_design / distributed / sql_modeling / streaming / production_ops),
-- свой fork-branch ('de' в 00047_learning_state), своя curated-цепочка
-- ресурсов. ML, наоборот, остался специализацией внутри dev_senior
-- (00046_drop_ml_track_kind) — у него нет такого же опорного mock-pool.
--
-- Down — no-op: ADD VALUE additive, drop требует enum-rebuild с риском
-- порчи данных (atlas_nodes/user_persona_tracks/hone_user_settings),
-- что не оправдано локальной потребностью.

-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'de'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'track_kind')
    ) THEN
        ALTER TYPE track_kind ADD VALUE 'de';
    END IF;
END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive enum value; rollback would require destructive enum rebuild
-- +goose StatementEnd
