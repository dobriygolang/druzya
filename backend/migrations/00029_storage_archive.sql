-- +goose Up
-- +goose StatementBegin
--
-- Phase C-2: archived_at — soft-archival для notes и whiteboards.
--
-- Поведение:
--   - List queries фильтруют WHERE archived_at IS NULL (не показываются
--     в основной outline / sidebar).
--   - Get-by-id всё ещё работает — junior запись recoverable через UI
--     «Restore from archive».
--   - storage_used_bytes recompute по-прежнему считает archived items
--     (они занимают место). Это сознательно: архивация ≠ deletion;
--     если юзер хочет освободить место — нажимает «Delete forever».
--
-- Рацио для отдельной archived_at вместо deleted_at:
--   - deleted_at семантически = «исчезло, через 30 дней GC». Юзер не
--     ждёт что оно пропадёт сам.
--   - archived_at = «убрано из глаз, но я помню». Юзер контролирует.
--   - Без этого разделения архивация превращается в soft-delete'ом, и
--     любой restore требует доп. UI / state.
ALTER TABLE hone_notes
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE hone_whiteboards
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Partial-индексы — list-queries (WHERE archived_at IS NULL) — самый
-- частый паттерн; без partial — общий B-tree включает архивные строки
-- и раздувается. Архивные read'ы редки (специальный «View archived»
-- view) — могут пройти seq-scan.
CREATE INDEX IF NOT EXISTS idx_hone_notes_user_active_updated
    ON hone_notes (user_id, updated_at DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_hone_whiteboards_user_active_updated
    ON hone_whiteboards (user_id, updated_at DESC)
    WHERE archived_at IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_hone_whiteboards_user_active_updated;
DROP INDEX IF EXISTS idx_hone_notes_user_active_updated;
ALTER TABLE hone_whiteboards DROP COLUMN IF EXISTS archived_at;
ALTER TABLE hone_notes DROP COLUMN IF EXISTS archived_at;
-- +goose StatementEnd
