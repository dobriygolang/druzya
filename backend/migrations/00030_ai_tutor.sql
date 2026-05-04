-- +goose Up
-- +goose StatementBegin

-- Расширяем users_role CHECK: добавляем 'ai_tutor'.
-- AI-юзеры live в той же users-таблице, чтобы существующие
-- tutor_students / ListMyTutors / GetStudentSnapshot работали без
-- изменений (см docs/feature/ai-tutor.md, "Reuse-first").
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_valid;
ALTER TABLE users ADD CONSTRAINT users_role_valid
    CHECK (role IN ('user','interviewer','admin','ai_tutor'));

-- 00030_ai_tutor.sql
--
-- AI-tutor — design в docs/feature/ai-tutor.md.
-- 4 слоя памяти:
--   episodic (ai_tutor_episodes) — каждый message immutable, audit-grade
--   working (ai_tutor_threads.summary_md) — rolling summary, перезаписывается compaction
--   semantic facts (ai_tutor_facts) — distilled выводы про студента
--   skill state — derived через существующий GetStudentSnapshot (нет новой таблицы)
--
-- Reuse существующего services/tutor: ai-tutor живёт как user с
-- role='ai_tutor', его relationship со студентом — обычная tutor_students
-- запись. ListMyTutors уже работает, snapshot/brief тоже.

-- Personas — БД-row, не в коде. Админ tunes prompt без релиза.
CREATE TABLE ai_tutor_personas (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug              text UNIQUE NOT NULL,
    display_name      text NOT NULL,
    scope_track_kind  track_kind NOT NULL,
    -- prompt_template содержит плейсхолдеры {{snapshot}} / {{facts}} /
    -- {{summary}} / {{user_message}}, которые SendMessage UC заполняет.
    prompt_template   text NOT NULL,
    -- pace_per_week — сколько assignments cron генерит на студента.
    -- 0 = не генерим, тутор только chat.
    pace_per_week     int  NOT NULL DEFAULT 3,
    -- llm_task_kind — entry в llmchain TaskMap. Через task_map.go
    -- админ может перезавести free-tier provider chain.
    llm_task_kind     text NOT NULL,
    active            boolean NOT NULL DEFAULT true,
    -- ai_user_id — id юзера в users с role='ai_tutor', созданного при
    -- первом adopt'е. NULL до первого adopt'а; populated lazily.
    ai_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Один thread per (student, persona). Каждая персона = свой канал
-- разговора со своей памятью.
CREATE TABLE ai_tutor_threads (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona_id          uuid NOT NULL REFERENCES ai_tutor_personas(id) ON DELETE RESTRICT,
    -- Rolling summary — перезаписывается каждой compaction.
    summary_md          text NOT NULL DEFAULT '',
    message_count       int  NOT NULL DEFAULT 0,
    last_compacted_at   timestamptz,
    -- Per-day rate limit на free-tier LLM. Сбрасывается на новый день.
    daily_msg_count     int  NOT NULL DEFAULT 0,
    daily_msg_reset_date date NOT NULL DEFAULT CURRENT_DATE,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE(student_id, persona_id)
);

CREATE INDEX ai_tutor_threads_student_idx
    ON ai_tutor_threads (student_id, updated_at DESC);

-- Episodic memory — every message immutable. Audit + recall pool.
CREATE TABLE ai_tutor_episodes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id     uuid NOT NULL REFERENCES ai_tutor_threads(id) ON DELETE CASCADE,
    -- role:
    --   'user'             — student wrote
    --   'assistant'        — AI responded
    --   'system'           — system event (welcome, persona-switch)
    --   'assignment'       — cron pushed assignment (logged here for context)
    --   'snapshot_inject'  — periodic snapshot stat dump for AI context
    role          text NOT NULL CHECK (role IN ('user','assistant','system','assignment','snapshot_inject')),
    content       text NOT NULL,
    model_used    text NOT NULL DEFAULT '',
    tokens_in     int  NOT NULL DEFAULT 0,
    tokens_out    int  NOT NULL DEFAULT 0,
    occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_tutor_episodes_thread_idx
    ON ai_tutor_episodes (thread_id, occurred_at);

-- Semantic facts — distilled student-specific knowledge.
-- Per-thread (а не per-student) потому что разные персоны накапливают
-- разные углы знания: algo-coach держит «struggles with DP»,
-- english-coach держит «B2 vocab gap». Cross-persona sharing — V2.
CREATE TABLE ai_tutor_facts (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id         uuid NOT NULL REFERENCES ai_tutor_threads(id) ON DELETE CASCADE,
    -- fact_key — semantic, free-form. Примеры: 'goal', 'weak_topic',
    -- 'preferred_lang', 'interview_date', 'company_target'.
    fact_key          text NOT NULL,
    fact_value        text NOT NULL,
    -- 0..1; explicit user statement → 1.0; LLM-extracted hypothesis → 0.5
    confidence        double precision NOT NULL DEFAULT 0.5,
    source_episode_id uuid REFERENCES ai_tutor_episodes(id) ON DELETE SET NULL,
    last_used_at      timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE(thread_id, fact_key)
);

-- Recall ranking: high confidence + recent use first.
CREATE INDEX ai_tutor_facts_recall_idx
    ON ai_tutor_facts (thread_id, confidence DESC, last_used_at DESC);

-- ── Seed 4 курируемых персоны ──
-- llm_task_kind должен соответствовать entry в shared/pkg/llmchain/task_map.go
-- (TaskAITutorChat — добавим в день 2).

INSERT INTO ai_tutor_personas (slug, display_name, scope_track_kind, prompt_template, pace_per_week, llm_task_kind) VALUES
('algo-coach', 'Алёша · алго-коуч', 'dev', $$Ты — Алёша, AI-coach по алгоритмам и структурам данных. Стиль: short, direct, pragmatic. Не патернализируй.

Контекст ученика:
{{snapshot}}

Что я о тебе знаю (facts):
{{facts}}

Сводка прошлых разговоров:
{{summary}}

Сообщение ученика:
{{user_message}}$$, 3, 'TaskAITutorChat'),

('sql-mentor', 'Лена · SQL-ментор', 'dev', $$Ты — Лена, AI-mentor по SQL и базам данных. Дотошная, требуешь EXPLAIN, не пропускаешь N+1.

Контекст ученика:
{{snapshot}}

Что я о тебе знаю (facts):
{{facts}}

Сводка прошлых разговоров:
{{summary}}

Сообщение ученика:
{{user_message}}$$, 2, 'TaskAITutorChat'),

('sysdesign-guru', 'Кирилл · sysdesign-guru', 'dev_senior', $$Ты — Кирилл, AI-coach по System Design на staff/principal-уровне. Спрашиваешь про trade-offs, capacity numbers, failure modes — не даёшь скользить.

Контекст ученика:
{{snapshot}}

Что я о тебе знаю (facts):
{{facts}}

Сводка прошлых разговоров:
{{summary}}

Сообщение ученика:
{{user_message}}$$, 2, 'TaskAITutorChat'),

('english-coach', 'Maria · English coach', 'english', $$You are Maria, an English speaking-and-writing coach for tech interviews. Short replies, correct grammar gently inline, push for clarity.

Student context:
{{snapshot}}

Facts I know about you:
{{facts}}

Past conversation summary:
{{summary}}

Student message:
{{user_message}}$$, 4, 'TaskAITutorChat')
ON CONFLICT (slug) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS ai_tutor_facts CASCADE;
DROP TABLE IF EXISTS ai_tutor_episodes CASCADE;
DROP TABLE IF EXISTS ai_tutor_threads CASCADE;
DROP TABLE IF EXISTS ai_tutor_personas CASCADE;
-- +goose StatementEnd
