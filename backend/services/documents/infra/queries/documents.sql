-- Queries consumed by sqlc. Mirrors hand-rolled pgx in infra/postgres.go
-- where raw SQL needs special shapes (batch insert of chunks, similarity
-- search) that sqlc can't generate idiomatically.

-- =============================================================================
-- documents
-- =============================================================================

-- name: InsertDocument :one
-- Idempotent by (user_id, sha256): повторная загрузка того же файла
-- возвращает уже существующую строку вместо дубликата. Это даёт клиенту
-- "the same upload twice is a no-op" без lookup-before-insert race.
INSERT INTO documents (user_id, filename, mime, size_bytes, sha256, source_url)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (user_id, sha256) DO UPDATE
   SET updated_at = now()
RETURNING id, user_id, filename, mime, size_bytes, sha256, source_url,
          status, error_message, chunk_count, token_count,
          created_at, updated_at;

-- name: GetDocument :one
-- User-scoped fetch. Если doc принадлежит другому пользователю, возвращает
-- "not found" через ErrNoRows — handler сверху мапит в 404.
SELECT id, user_id, filename, mime, size_bytes, sha256, source_url,
       status, error_message, chunk_count, token_count,
       created_at, updated_at
  FROM documents
 WHERE id = $1 AND user_id = $2;

-- name: ListDocumentsByUser :many
-- Keyset pagination by created_at DESC, id DESC. is_first_page=true
-- возвращает свежайшую страницу без синтетического cursor'а. Limit
-- укладывает отдачу; API cap должен быть ≤ 100.
SELECT id, user_id, filename, mime, size_bytes, sha256, source_url,
       status, error_message, chunk_count, token_count,
       created_at, updated_at
  FROM documents
 WHERE user_id = $1
   AND (
     sqlc.arg('is_first_page')::BOOLEAN
     OR (created_at, id) < (sqlc.arg('cursor_created_at')::TIMESTAMPTZ, sqlc.arg('cursor_id')::UUID)
   )
 ORDER BY created_at DESC, id DESC
 LIMIT sqlc.arg('page_size')::INT;

-- name: UpdateDocumentStatus :execrows
-- Атомарное обновление статуса + денормализованных counters. Вызывается
-- воркёром после extract/embed: ('ready', '', chunk_count, total_tokens)
-- или ('failed', error_text, 0, 0). Ошибка хранится как текст, структура
-- клиенту не нужна.
UPDATE documents
   SET status        = $2,
       error_message = $3,
       chunk_count   = $4,
       token_count   = $5,
       updated_at    = now()
 WHERE id = $1;

-- name: DeleteDocument :execrows
-- User-scoped. Cascade drop doc_chunks через FK (ON DELETE CASCADE).
-- Если row не принадлежит пользователю, rows_affected = 0 → handler
-- возвращает 404 и не раскрывает факт существования чужого doc.
DELETE FROM documents
 WHERE id = $1 AND user_id = $2;

-- =============================================================================
-- doc_chunks
-- =============================================================================

-- name: InsertDocChunk :one
-- Single-chunk insert. Для массовой вставки (N чанков за раз) используем
-- CopyFrom в infra/postgres.go — sqlc не умеет в его bulk API.
INSERT INTO doc_chunks (doc_id, ord, content, embedding, token_count)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, doc_id, ord, content, embedding, token_count, created_at;

-- name: ListChunksByDoc :many
-- Для RAG-поиска поднимаем все чанки документов session.documents и
-- считаем cosine на стороне Go. На объёме ≤ 5k чанков это быстрее чем
-- даже ivfflat без прогретого кеша; см. комментарий в миграции 00011.
SELECT id, doc_id, ord, content, embedding, token_count, created_at
  FROM doc_chunks
 WHERE doc_id = ANY($1::UUID[])
 ORDER BY doc_id, ord;

-- name: DeleteChunksByDoc :execrows
-- Обычно не вызываем — cascade через FK drop делает это автоматически.
-- Оставляем для re-embedding path'а (сначала вычистить старые чанки,
-- потом вставить новые в одной транзакции).
DELETE FROM doc_chunks
 WHERE doc_id = $1;
