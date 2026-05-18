-- +goose Up
DROP TABLE IF EXISTS energy_logs CASCADE;
DROP TABLE IF EXISTS day_shutdowns CASCADE;

-- +goose Down
-- Recovery requires manual restore from baseline; not provided.
SELECT 1;
