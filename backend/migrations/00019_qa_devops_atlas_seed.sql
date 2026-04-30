-- 00019_qa_devops_atlas_seed.sql
--
-- Wave 9.2 + 9.3 of docs/feature/plan.md — добавляет ТОЛЬКО метку
-- 'devops' в track_kind enum. Сам seed (atlas_nodes + atlas_edges)
-- живёт в 00022_qa_devops_atlas_seed_data.sql — Postgres запрещает
-- использовать новое enum-значение в той же транзакции, где оно было
-- создано (SQLSTATE 55P04), поэтому INSERT'ы вынесены в следующую
-- миграцию.
--
-- 'qa' уже есть в enum'е с 00001 baseline — её добавлять не нужно.

-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'devops'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'track_kind')
    ) THEN
        ALTER TYPE track_kind ADD VALUE 'devops';
    END IF;
END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive enum value; rollback drops the DB
-- +goose StatementEnd
