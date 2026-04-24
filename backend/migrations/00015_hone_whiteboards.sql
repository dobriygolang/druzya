-- 00015_hone_whiteboards.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Hone whiteboards — приватный tldraw-canvas c on-demand AI-критикой.
--
-- state_json хранит весь tldraw-документ (shapes, bindings, viewport). Он
-- opaque для сервера — сервер не парсит; это jsonb только ради валидации
-- на вставку. Размеры документов в реальности ~50-500KB, для корпоративного
-- B2B могут вырасти до нескольких МБ (массивные архитектурные диаграммы),
-- но для MVP ограничений не ставим.
--
-- Optimistic concurrency: каждый UpdateWhiteboard бампает version и падает
-- если клиент прислал expected_version != текущего. Это защищает от
-- "одновременной" работы с двух машин юзера (редко, но возможно).
-- ────────────────────────────────────────────────────────────────────────────

-- +goose Up
-- +goose StatementBegin

CREATE TABLE hone_whiteboards (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       text        NOT NULL DEFAULT 'Untitled',
    state_json  jsonb       NOT NULL DEFAULT '{}'::jsonb,
    version     int         NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hone_whiteboards_user_updated ON hone_whiteboards (user_id, updated_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS hone_whiteboards;
-- +goose StatementEnd
