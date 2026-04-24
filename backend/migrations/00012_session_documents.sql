-- +goose Up
-- +goose StatementBegin
-- Attach documents to a copilot session so the Analyze/Chat pipeline can
-- pull them as RAG context. Column-on-row storage (UUID[]) vs. a join
-- table:
--   - sessions carry O(1..20) documents in practice; a join is overkill;
--   - Analyze reads document_ids on EVERY turn, keeping it in the same
--     row saves a JOIN on the hot path;
--   - cascade semantics stay simple — deleting a session drops its
--     attachment list, deleting a document leaves stale ids in the
--     array that the searcher skips (see documents.app.Search's
--     filterOwnedDocIDs defence-in-depth).
--
-- UUID[] works with pgx natively ([]uuid.UUID ↔ uuid[]) so no custom
-- type registration is needed.
ALTER TABLE copilot_sessions
    ADD COLUMN document_ids UUID[] NOT NULL DEFAULT '{}';

-- Optional GIN index on document_ids — useful if we ever need "show me
-- all sessions that reference this document" (e.g. for a future
-- document-wipe flow). Cheap on write for tiny arrays; we put it in
-- from day one so the ALTER doesn't need to repeat later.
CREATE INDEX idx_copilot_sessions_document_ids
    ON copilot_sessions USING GIN (document_ids);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_copilot_sessions_document_ids;
ALTER TABLE copilot_sessions
    DROP COLUMN IF EXISTS document_ids;
-- +goose StatementEnd
