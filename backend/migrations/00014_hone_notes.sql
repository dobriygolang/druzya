-- 00014_hone_notes.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Hone notes — приватные markdown-заметки с AI-авто-связями.
--
-- Embeddings: bge-small-en-v1.5 (384-dim) через Ollama. Можно было бы
-- использовать pgvector, но добавлять расширение ради одной колонки
-- перебор для MVP — храним как float4[] и считаем косинусы в Go
-- (brute-force, корпус ~10k записей на юзера в пределах реалистичного).
-- Если корпус вырастет — апгрейдимся на pgvector в отдельной миграции.
--
-- Connections: разрешаются on-demand через GetNoteConnections stream, не
-- персистим. Кеш embeddings'ов живёт в llmcache (Redis), fallback — пересчёт
-- при первом запросе.
-- ────────────────────────────────────────────────────────────────────────────

-- +goose Up
-- +goose StatementBegin

CREATE TABLE hone_notes (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           text        NOT NULL DEFAULT 'Untitled',
    body_md         text        NOT NULL DEFAULT '',
    size_bytes      int         NOT NULL DEFAULT 0,
    -- embedding — 384-dim вектор от bge-small-en-v1.5. NULL до первого
    -- update, когда note_store асинхронно триггерит перерасчёт.
    embedding       real[],
    embedding_model text,                             -- "bge-small-en-v1.5:<ver>"
    embedded_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Покрывает ListNotes (last N updated) и поиск по юзеру.
CREATE INDEX idx_hone_notes_user_updated ON hone_notes (user_id, updated_at DESC);

-- FTS-поиск по title + body для командной палитры (planned v2). Сейчас
-- не используется приложением — индекс готов заранее чтобы избежать
-- миграции когда потребуется.
CREATE INDEX idx_hone_notes_fts ON hone_notes
    USING gin (to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(body_md, '')));

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS hone_notes;
-- +goose StatementEnd
