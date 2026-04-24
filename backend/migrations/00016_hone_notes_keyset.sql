-- 00016_hone_notes_keyset.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Keyset-пагинация для ListNotes: WHERE (updated_at, id) < ($c_ts, $c_id)
-- ORDER BY updated_at DESC, id DESC. Старый индекс (user_id, updated_at DESC)
-- покрывает диапазон по updated_at, но не умеет tiebreak'ить строки с
-- одинаковым updated_at — на массовом импорте (N заметок в одну и ту же
-- миллисекунду) это даёт пропуски/дубли на границе страницы.
--
-- Новый композитный индекс делает tuple-comparison index-only.
-- ────────────────────────────────────────────────────────────────────────────

-- +goose Up
-- +goose StatementBegin

CREATE INDEX IF NOT EXISTS idx_hone_notes_user_updated_id
    ON hone_notes (user_id, updated_at DESC, id DESC);

DROP INDEX IF EXISTS idx_hone_notes_user_updated;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

CREATE INDEX IF NOT EXISTS idx_hone_notes_user_updated ON hone_notes (user_id, updated_at DESC);
DROP INDEX IF EXISTS idx_hone_notes_user_updated_id;

-- +goose StatementEnd
