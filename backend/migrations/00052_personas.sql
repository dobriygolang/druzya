-- +goose Up
-- +goose StatementBegin
--
-- 00051 — personas: admin-editable catalogue of expert-mode prompts
-- for the desktop Copilot's persona picker.
--
-- Replaces the hardcoded list in desktop/src/shared/personas.ts. Each
-- row is a full preset: label shown in the picker, one-line hint,
-- emoji + gradient for the brand-mark, suggested llmchain task, and
-- the system-prompt that gets prepended to user messages when the
-- persona is active.
--
-- Mirrors the llm_models pattern (migration 00033): single-table CRUD,
-- is_enabled for soft-delete, sort_order for picker ordering.
--
-- Why a table instead of code:
--   • A/B test system prompts without a desktop redeploy
--   • Add a new expert domain (Rust / ML / DevOps / iOS / …) in 2 min
--     via admin UI, not a sprint
--   • Operators can disable a persona that's underperforming without
--     shipping a release
--
-- Anti-fallback: if this table is empty, the desktop picker hides
-- everything except the "default" persona (also stored here as a row,
-- not special-cased in code). Admin MUST seed at least the default
-- persona for the picker to appear at all.

CREATE TABLE IF NOT EXISTS personas (
    -- Stable slug used as both primary key and wire identifier. Never
    -- rename — users' last-pick is persisted by this value on the
    -- desktop side (localStorage). "default" is reserved for the
    -- no-prefix baseline.
    id              TEXT        PRIMARY KEY,
    label           TEXT        NOT NULL,
    hint            TEXT        NOT NULL DEFAULT '',
    -- Emoji rendered as the picker-row icon. Kept as text (not
    -- unicode constant) so a non-emoji string works too if an admin
    -- wants a two-letter abbreviation ("RX" for React etc.).
    icon_emoji      TEXT        NOT NULL DEFAULT '💬',
    -- CSS gradient string. Applied to the compact brand-mark when the
    -- persona is active. Example:
    --   "linear-gradient(135deg, #61dafb 0%, #3178c6 100%)"
    -- We store the raw CSS rather than two hex colors + angle so
    -- admins can use radial / conic gradients later without a schema
    -- change. NULL-safe: empty string means "use default accent".
    brand_gradient  TEXT        NOT NULL DEFAULT '',
    -- Suggested llmchain task — see backend/shared/pkg/llmchain.Task.
    -- Values: 'copilot_stream' | 'insight_prose' | 'vacancies_json' |
    -- 'reasoning'. Empty = let the caller pick. Desktop uses this
    -- today only as a hint, not as a hard override.
    suggested_task  TEXT        NOT NULL DEFAULT '',
    -- The actual system prompt prepended to user messages at analyze/
    -- chat time. Empty = no prefix (baseline persona behavior).
    system_prompt   TEXT        NOT NULL DEFAULT '',
    sort_order      INT         NOT NULL DEFAULT 100,
    is_enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personas_enabled_sort_idx
    ON personas (is_enabled, sort_order);

-- Seed the catalogue that used to live in desktop/src/shared/personas.ts.
-- After this migration lands, the desktop stops shipping the hardcoded
-- list and pulls from GET /api/v1/personas instead.
INSERT INTO personas (id, label, hint, icon_emoji, brand_gradient, suggested_task, system_prompt, sort_order) VALUES
    (
        'default',
        'Обычный',
        'Без специализации — универсальный режим',
        '💬',
        'linear-gradient(135deg, var(--d-accent) 0%, var(--d-accent-2) 100%)',
        '',
        '',
        10
    ),
    (
        'react',
        'React Expert',
        'React · TypeScript · Next.js · performance',
        '⚛️',
        'linear-gradient(135deg, #61dafb 0%, #3178c6 100%)',
        'copilot_stream',
        'Инструкция: ты senior React-разработчик. Отвечаешь строго в контексте React / TypeScript / Next.js / React Query / Zustand. Всегда показывай рабочий код в fenced-блоке с language-тегом. Упоминай re-render impact, hooks rules, concurrent-режим когда это уместно. Если вопрос вне фронтенд-стека — честно скажи что это не твоя специализация.',
        20
    ),
    (
        'system-design',
        'System Design',
        'Distributed systems · SRE · capacity planning',
        '🏛️',
        'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
        'reasoning',
        'Инструкция: ты senior system-design интервьюер из FAANG. Отвечаешь по схеме: (1) clarify requirements — что именно строим, какой QPS, SLA, consistency; (2) high-level architecture — компоненты и их API; (3) deep-dives — шардирование, кеш, очереди, репликация; (4) trade-offs — где cut corners на MVP. Числовые прикидки (QPS, storage, bandwidth) обязательно. Рисуй ASCII-диаграммы когда помогает.',
        30
    ),
    (
        'go-sre',
        'Go / SRE',
        'Go · Kubernetes · observability · incident response',
        '🐹',
        'linear-gradient(135deg, #00add8 0%, #5ac8e6 100%)',
        'copilot_stream',
        'Инструкция: ты senior Go-разработчик и SRE. Отвечаешь в контексте Go / gRPC / Kubernetes / Prometheus / OpenTelemetry. Для кода — идиоматичный Go с корректной обработкой ошибок (errors.Is/As, wrapping), context-propagation и отсутствием goroutine-ликов. Для infra-вопросов — объясняй через debugging-first lens: какие метрики / логи / traces смотреть, какие k8s-события, как воспроизвести. Ссылайся на конкретные Go-пакеты и k8s-объекты.',
        40
    ),
    (
        'behavioral',
        'Behavioral',
        'STAR · leadership · conflict · trade-offs',
        '🎭',
        'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
        'insight_prose',
        'Инструкция: ты поведенческий коуч для Big-Tech интервью. Отвечаешь строго по STAR-формату (Situation · Task · Action · Result) когда это ответ на поведенческий вопрос. Фокус на метриках результата, конкретных решениях и lessons learned. Если вопрос — это framework самого интервьюера (тип "how to tell stories"), дай компактный шаблон. Никакой воды; каждое предложение должно нести факт или инструкцию.',
        50
    ),
    (
        'dsa',
        'DSA',
        'Algorithms · data structures · LeetCode-style problems',
        '🧮',
        'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
        'copilot_stream',
        'Инструкция: ты senior интервьюер по алгоритмам. Отвечаешь по схеме: (1) переформулируй задачу своими словами + edge-cases; (2) brute-force подход + его сложность; (3) оптимальное решение с обоснованием почему именно так; (4) код на Go или Python — выбор по контексту вопроса; (5) анализ time/space complexity строго в O-нотации. Именуй паттерн (two pointers, sliding window, monotonic stack…) явно.',
        60
    )
ON CONFLICT (id) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS personas_enabled_sort_idx;
DROP TABLE IF EXISTS personas;
-- +goose StatementEnd
