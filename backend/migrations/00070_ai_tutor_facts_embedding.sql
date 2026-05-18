-- +goose Up
-- +goose StatementBegin

-- Семантический recall фактов tutor'а. Хранит bge-m3 embedding (1024-dim,
-- multilingual ru/en) для каждого fact'а; SendMessage делает cosine-поиск
-- по запросу пользователя и комбинирует с confidence + recency. При
-- отсутствии embedding'а (Ollama выключен, новый fact ещё не embedнут)
-- recall гасится в legacy ranked-путь — service деградирует, не падает.
ALTER TABLE public.ai_tutor_facts
    ADD COLUMN IF NOT EXISTS embedding_vec public.vector(1024),
    ADD COLUMN IF NOT EXISTS embed_model text,
    ADD COLUMN IF NOT EXISTS embedded_at timestamp with time zone;

-- ivfflat для cosine similarity. lists=50 рассчитан на typical thread
-- (<1k facts); при росте можно перестроить с большим lists. Partial index
-- (WHERE embedding_vec IS NOT NULL) держит btree узким — большинство
-- старых rows не embedнуты пока background scan не пройдёт.
CREATE INDEX IF NOT EXISTS idx_ai_tutor_facts_embedding_vec
    ON public.ai_tutor_facts
    USING ivfflat (embedding_vec public.vector_cosine_ops)
    WITH (lists='50')
    WHERE (embedding_vec IS NOT NULL);

-- Для будущего async backfill — индекс на rows, которые ещё не embed'нуты.
CREATE INDEX IF NOT EXISTS idx_ai_tutor_facts_pending_embedding
    ON public.ai_tutor_facts (created_at)
    WHERE (embedded_at IS NULL);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS public.idx_ai_tutor_facts_pending_embedding;
DROP INDEX IF EXISTS public.idx_ai_tutor_facts_embedding_vec;

ALTER TABLE public.ai_tutor_facts
    DROP COLUMN IF EXISTS embedded_at,
    DROP COLUMN IF EXISTS embed_model,
    DROP COLUMN IF EXISTS embedding_vec;

-- +goose StatementEnd
