-- +goose Up
-- +goose StatementBegin
--
-- Phase C-7+: visibility flag для shared whiteboard rooms.
--
-- Концепт: каждая комната рождается private — только owner может её
-- открыть. При флипе на 'shared' любой с URL может подключиться (как
-- работало до этой миграции по умолчанию).
--
-- Backward compat: existing rooms получают 'shared' (текущее поведение).
-- Новые комнаты — TODO в app-layer'е могут стартовать с 'private' если
-- захочется поменять default; миграция выставляет default на 'shared'
-- чтобы не сломать существующий UX до того как UI toggle прокатится в
-- production.
--
-- Enforcement: GetWhiteboardRoom / WS-join handler'ы должны проверять:
--   IF visibility = 'private' AND requester != owner → 403/Forbidden.
-- В этой миграции — только schema; enforcement в отдельном patch'е
-- (whiteboard_rooms service handler).
ALTER TABLE whiteboard_rooms
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'shared'
        CHECK (visibility IN ('private', 'shared'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE whiteboard_rooms DROP COLUMN IF EXISTS visibility;
-- +goose StatementEnd
