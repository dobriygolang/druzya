-- +goose Up
-- +goose StatementBegin
--
-- Phase C-4: «Publish to web» для hone_notes.
--
-- Концепт:
--   - published_at = NULL → private (default).
--   - published_at = TIMESTAMPTZ → public. Видна по URL /p/{public_slug}.
--   - public_slug — short URL-safe идентификатор (12 hex chars). NOT
--     равен note.id чтобы не предоставить enumeration vector (любой
--     юзер мог бы перебрать UUID v4 — sparse, но всё же; slug —
--     128-bit random, equally sparse, но не утекает note.id).
--
-- Ownership:
--   - Edit/delete доступны только владельцу через app (как и сейчас).
--   - Публичный URL — read-only mirror.
--   - Update владельцем синхронно отражается на public странице
--     (тот же row, без отдельной published-копии). Это сознательный
--     trade-off: «не realtime» — публика не перезагружает страницу
--     автоматически, но при следующем открытии URL получит свежий body.
--
-- Slug index — UNIQUE для hot-path /p/{slug} lookup.
ALTER TABLE hone_notes
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS public_slug  TEXT;

-- Partial UNIQUE — slug NULL для unpublished'ых, NULL'ы не conflict'уют
-- в Postgres unique-индексе (multi-NULL разрешён). Но мы хотим
-- defensive constraint: если slug установлен — он уникален.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hone_notes_public_slug
    ON hone_notes(public_slug)
    WHERE public_slug IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_hone_notes_public_slug;
ALTER TABLE hone_notes
    DROP COLUMN IF EXISTS public_slug,
    DROP COLUMN IF EXISTS published_at;
-- +goose StatementEnd
