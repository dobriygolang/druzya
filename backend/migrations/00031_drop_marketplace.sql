-- +goose Up
-- +goose StatementBegin

-- 00031_drop_marketplace.sql
--
-- Pivot 2026-05-01 — Boosty marketplace выпилен (см
-- docs/feature/identity.md). Tutor toolkit становится free-for-all,
-- никаких listings/packages/payment-flow.
--
-- Drop'аем `tutor_listings` и `tutor_listing_packages` целиком.
-- Backend services + frontend pages + proto messages удалены отдельным
-- коммитом — миграция чистит финальную инфру.

DROP TABLE IF EXISTS tutor_listing_packages CASCADE;
DROP TABLE IF EXISTS tutor_listings CASCADE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- one-way drop; rollback drops the DB
-- +goose StatementEnd
