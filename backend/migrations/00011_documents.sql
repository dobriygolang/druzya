-- +goose Up
-- +goose StatementBegin
-- documents: пользовательские файлы (PDF/DOCX/TXT/MD/HTML), которые потом
-- подгружаются в контекст copilot'а как RAG-источник. Одна строка = один
-- исходный файл; чанки с эмбеддингами лежат в doc_chunks.
--
-- sha256 уникален per user — позволяет dedup повторной загрузки того же
-- файла и даёт быстрый idempotent upsert. Не делаем global-unique: два
-- разных пользователя могут грузить одинаковый PDF, каждый хочет свой.
--
-- status даёт асинхронный pipeline: extract → chunk → embed. Живая
-- загрузка возвращает 'pending'; фоновый воркёр двигает в 'ready' или
-- 'failed' с error_message. 'deleting' — переходный для soft-delete пока
-- не дочистили chunk'и (сейчас cascade синхронный, но поле оставляем
-- чтобы не ломать схему когда перейдём на async cleanup).
CREATE TABLE documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    mime          TEXT NOT NULL,
    size_bytes    BIGINT NOT NULL,
    sha256        TEXT NOT NULL,
    source_url    TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT NOT NULL DEFAULT '',
    chunk_count   INT  NOT NULL DEFAULT 0,
    token_count   INT  NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT documents_status_valid CHECK (
        status IN ('pending','extracting','embedding','ready','failed','deleting')
    ),
    CONSTRAINT documents_size_positive CHECK (size_bytes > 0),
    -- Hard cap: 10MB on the raw file — PDF > 10MB is almost always slides
    -- with images (useless for RAG) or a scan that needs OCR (out of
    -- scope for MVP). Reject at the API boundary too so users get a clear
    -- error; this is the belt-and-suspenders backstop.
    CONSTRAINT documents_size_cap CHECK (size_bytes <= 10 * 1024 * 1024),
    UNIQUE (user_id, sha256)
);

CREATE INDEX idx_documents_user_created
    ON documents (user_id, created_at DESC);

-- doc_chunks: семантические куски одного документа, каждый с embedding.
--
-- Выбор хранения эмбеддингов:
--   embedding real[] (Postgres float4 array) вместо pgvector vector(384).
-- Причины: (1) pgvector требует extension + сборку под него Postgres-образа,
-- что тянет изменение docker-compose + CI для migration-теста; (2) на
-- нашем масштабе (≤ 100 документов на пользователя × 50 чанков ≈ 5000
-- строк, cosine-поиск top-k через brute force в Go = <10ms); (3) любой
-- пользовательский RAG-запрос ограничен session.documents → выборка по
-- doc_id заранее сужает до единиц документов. Index acceleration не
-- нужен на этих объёмах.
--
-- Апгрейд-путь к pgvector, когда это перестанет быть правдой:
--   ALTER TABLE doc_chunks ALTER COLUMN embedding TYPE vector(384)
--     USING embedding::vector;
--   CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops);
-- Приложение тогда переедет с Go-cosine на `ORDER BY embedding <=> $1`.
-- Изменение схемы локальное; app-код меняется в одном месте (repo).
CREATE TABLE doc_chunks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id      UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ord         INT  NOT NULL,
    content     TEXT NOT NULL,
    embedding   REAL[] NOT NULL,
    token_count INT  NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT doc_chunks_ord_nonneg CHECK (ord >= 0),
    CONSTRAINT doc_chunks_content_nonempty CHECK (length(content) > 0),
    CONSTRAINT doc_chunks_embedding_dim CHECK (array_length(embedding, 1) = 384),
    UNIQUE (doc_id, ord)
);

-- Hot path: RAG-запрос берёт все чанки сессии (N документов) и гоняет
-- cosine на стороне Go. Индекс по doc_id даёт O(log N) к подтягиванию
-- чанков одного документа — критично когда мы join'им session.documents.
CREATE INDEX idx_doc_chunks_doc
    ON doc_chunks (doc_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS doc_chunks;
DROP TABLE IF EXISTS documents;
-- +goose StatementEnd
