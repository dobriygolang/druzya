-- +goose Up
-- +goose StatementBegin
-- Runtime-reloadable конфигурация LLM chain'а. Админ меняет порядок
-- провайдеров / task-map / virtual-chains БЕЗ рестарта api — loader
-- в llmchain периодически читает эту таблицу (раз в 30 сек) и
-- атомарно подменяет active config через atomic.Pointer.
--
-- Singleton: всегда ровно одна строка (id=1). CHECK гарантирует что
-- никто случайно не создаст вторую через INSERT.
--
-- version — счётчик для optimistic-locking в админских PUT (админ
-- присылает version, UPDATE проходит только если cur_version = expected).
CREATE TABLE llm_runtime_config (
    id             INT PRIMARY KEY DEFAULT 1,
    version        BIGINT NOT NULL DEFAULT 1,
    chain_order    TEXT[] NOT NULL DEFAULT '{}',
    task_map       JSONB  NOT NULL DEFAULT '{}'::jsonb,
    virtual_chains JSONB  NOT NULL DEFAULT '{}'::jsonb,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT llm_runtime_config_singleton CHECK (id = 1)
);

-- Инициализация singleton'а пустыми значениями. loader трактует пустой
-- chain_order / task_map как "используй hardcoded defaults из tier.go и
-- task_map.go". Это позволяет деплоить миграцию сейчас, а переходить на
-- data-driven конфиг — постепенно (админ заполняет нужное, остальное
-- продолжает работать из defaults).
INSERT INTO llm_runtime_config (id, chain_order, task_map, virtual_chains)
VALUES (1, '{}', '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS llm_runtime_config;
-- +goose StatementEnd
