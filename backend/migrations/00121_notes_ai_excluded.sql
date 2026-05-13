-- 00121_notes_ai_excluded.sql — Phase K Wave 15 «AI-readable» flag.
--
-- Pre-existing privacy gate — `encrypted` (vault) — полностью исключает
-- ноту из LLM-обработки. Но это hard-mode (E2E ключ + no recovery).
-- Юзер хочет более мягкий вариант: «не encrypt'ить, но и не давать AI
-- читать эту конкретную заметку».
--
-- `ai_excluded BOOLEAN NOT NULL DEFAULT false` — нота видна сервером
-- plaintext'ом, но SuggestTasksFromNotes / Coach next-action reading
-- pipeline её пропускают. Embedding pipeline продолжает работать
-- (cosine / search), потому что cosine — это не «AI читает текст»;
-- если юзер хочет жёстче — есть vault.
--
-- Index — partial covering filter для SuggestTasksFromNotes:
--   WHERE NOT ai_excluded AND NOT encrypted
-- Plus updated_at DESC для recency-первого scan'а (7 дней window).
-- encrypted=true заметки — не индексируем сюда, у них всё равно
-- ai_excluded ignor'ируется (encrypted сам по себе уже opt-out).

-- +goose Up
-- +goose StatementBegin

ALTER TABLE hone_notes
    ADD COLUMN IF NOT EXISTS ai_excluded BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_hone_notes_ai_available
    ON hone_notes(user_id, updated_at DESC)
    WHERE NOT ai_excluded AND NOT encrypted;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_hone_notes_ai_available;
ALTER TABLE hone_notes DROP COLUMN IF EXISTS ai_excluded;

-- +goose StatementEnd
