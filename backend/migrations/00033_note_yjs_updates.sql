-- +goose Up
-- +goose StatementBegin
--
-- Phase C-6 (foundation): note_yjs_updates — append-only log Yjs CRDT
-- updates на per-note basis.
--
-- Архитектура (см. docs/sync-architecture.md §1 «Yjs persistence model»):
--
--   Server — это dumb storage. Yjs CRDT semantics живут на клиенте
--   (в Y.Doc'е). Server только хранит binary update-сообщения и отдаёт
--   их по запросу. Это позволяет нам обойтись БЕЗ Go-port'а Yjs (которые
--   все либо альфа-качества, либо медленные) и при этом получить full
--   CRDT semantics — два клиента редактируют одновременно, оба append'ят
--   updates, любой третий клиент при pull'е получит обе и Yjs CRDT их
--   корректно слитым покажет.
--
-- Жизненный цикл записи:
--   1. Client edit'ит → Yjs producer'ит update message (binary delta).
--   2. POST /api/v1/sync/yjs/{noteId}/append с этим binary'ом в body.
--   3. Server проверяет ownership (note belongs to user) и append'ит row.
--      seq = выдаётся через BIGSERIAL (монотонный per-table).
--
-- Жизненный цикл чтения:
--   4. Client при load заметки: GET /api/v1/sync/yjs/{noteId}/updates?
--      since=<last-seq> → массив updates.
--   5. Client апплаит каждый через Y.applyUpdate(doc, update). Doc
--      получается merged без conflict'ов.
--
-- Compaction (отдельный flow, не cron'ом, а client-инициированный):
--   6. Изредка клиент склеивает все локальные updates в один большой
--      `Y.encodeStateAsUpdate(doc)` и шлёт POST /compact с body=full-state.
--   7. Server в одной TX: вставляет full-state как новый update, удаляет
--      ВСЕ ранее имевшиеся (с seq < incoming.seq) для этого noteId.
--      Цикл compaction предотвращает unbounded log growth.
--
-- Размер update'а: типичный Yjs delta = 50-500 байт. Полный snapshot
-- средней заметки ~5KB. Storage на одну заметку = O(updates × 200B);
-- compaction делает O(snapshot_size). 90% операций — мелкие append'ы.
CREATE TABLE note_yjs_updates (
    seq          BIGSERIAL PRIMARY KEY,
    note_id      UUID NOT NULL REFERENCES hone_notes(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    update_data  BYTEA NOT NULL,
    -- origin_device_id — у append'ивающего устройства, чтобы pull
    -- (через streaming push в C-6.2) мог не возвращать собственные
    -- update'ы (echo prevention). nullable — допустим non-device origin
    -- (legacy, server cron, admin tooling).
    origin_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: read updates since last-seen seq.
CREATE INDEX idx_note_yjs_updates_note_seq
    ON note_yjs_updates(note_id, seq);

-- Authorization filter: user_id checked on every read/write.
CREATE INDEX idx_note_yjs_updates_user_seq
    ON note_yjs_updates(user_id, seq);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS note_yjs_updates;
-- +goose StatementEnd
