-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00008 social + ops: friends, notifications, podcasts CMS,
--   billing/subscriptions, support tickets, saved vacancies,
--   orgs, tg coach, llm registry, copilot, personas
-- Consolidated from: 00007 (billing/system parts minus anticheat/llm_configs),
--   00008 (seed config), 00013 support, 00014+00040+00041 vacancies,
--   00016 friends, 00017 notifications, 00025 podcasts CMS,
--   00027 orgs, 00029 tg coach, 00033+00044+00045/00046 llm_models seed,
--   00038 copilot, 00042 copilot_sessions, 00043 copilot free models,
--   00052 personas, 00053 copilot_report analysis
-- ============================================================

-- ─── billing + subscriptions ────────────────────────────────
CREATE TABLE boosty_accounts (
    user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    boosty_username   TEXT NOT NULL,
    verified_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
    user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan                 TEXT NOT NULL DEFAULT 'free',
    status               TEXT NOT NULL DEFAULT 'active',
    boosty_level         TEXT,
    current_period_end   TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_plan_valid CHECK (plan IN ('free','seeker','ascendant'))
);

CREATE TABLE ai_credits (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance     INT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── dynamic config (admin-editable runtime knobs) ──────────
CREATE TABLE dynamic_config (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    type        TEXT NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID REFERENCES users(id),
    CONSTRAINT dynconfig_type_valid CHECK (type IN ('int','float','string','bool','json'))
);

-- ─── notifications (outbound log + in-app feed + prefs) ─────
CREATE TABLE notifications_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel     TEXT NOT NULL,
    type        TEXT NOT NULL,
    payload     JSONB,
    status      TEXT NOT NULL DEFAULT 'pending',
    sent_at     TIMESTAMPTZ,
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT notify_channel_valid CHECK (channel IN ('telegram','email','push')),
    CONSTRAINT notify_status_valid  CHECK (status IN ('pending','sent','failed'))
);
CREATE INDEX idx_notifications_log_user ON notifications_log(user_id, created_at DESC);

CREATE TABLE notification_preferences (
    user_id                        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    channels                       TEXT[] NOT NULL DEFAULT ARRAY['telegram']::text[],
    telegram_chat_id               TEXT,
    quiet_hours_from               TIME,
    quiet_hours_to                 TIME,
    weekly_report_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    skill_decay_warnings_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- in-app feed for the bell-popup / NotificationsPage.
CREATE TABLE user_notifications (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel     TEXT NOT NULL,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    payload     JSONB,
    priority    INT NOT NULL DEFAULT 0,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_un_user_created ON user_notifications (user_id, created_at DESC);
CREATE INDEX idx_un_user_unread
    ON user_notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE notification_prefs (
    user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    channel_enabled  JSONB NOT NULL DEFAULT '{}'::jsonb,
    silence_until    TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE onboarding_progress (
    user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    step         INT NOT NULL DEFAULT 0,
    answers      JSONB,
    completed_at TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legacy llm_configs (feature-scope config snapshots). Still referenced
-- by older code paths; kept here for compatibility.
CREATE TABLE llm_configs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type   TEXT NOT NULL,
    scope_id     TEXT,
    model        TEXT NOT NULL,
    temperature  NUMERIC(3,2) NOT NULL DEFAULT 0.7,
    max_tokens   INT NOT NULL DEFAULT 2048,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT llm_scope_valid CHECK (scope_type IN ('default','task','section','company','user'))
);

-- ─── friendships ────────────────────────────────────────────
CREATE TABLE friendships (
    id            BIGSERIAL PRIMARY KEY,
    requester_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted','blocked')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at   TIMESTAMPTZ,
    CHECK (requester_id <> addressee_id),
    UNIQUE (requester_id, addressee_id)
);
CREATE INDEX idx_friendships_addr_status ON friendships (addressee_id, status);
CREATE INDEX idx_friendships_req_status  ON friendships (requester_id, status);

CREATE TABLE friend_codes (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL
);

-- ─── support tickets ────────────────────────────────────────
CREATE TABLE support_tickets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    contact_kind    TEXT NOT NULL CHECK (contact_kind IN ('email', 'telegram')),
    contact_value   TEXT NOT NULL,
    subject         TEXT NOT NULL DEFAULT '',
    message         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','in_progress','resolved','closed')),
    internal_note   TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);
CREATE INDEX idx_support_tickets_status_created
    ON support_tickets(status, created_at DESC);
CREATE INDEX idx_support_tickets_user
    ON support_tickets(user_id) WHERE user_id IS NOT NULL;

-- ─── saved vacancies (post-00040/00041 snapshot model) ─────
-- NB: legacy vacancies table was created in 00014 and dropped in 00041.
-- This is the final shape — self-contained snapshot per (user, source, ext id).
CREATE TABLE saved_vacancies (
    id             BIGSERIAL PRIMARY KEY,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source         TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    snapshot_json  JSONB NOT NULL,
    status         TEXT NOT NULL DEFAULT 'saved'
                     CHECK (status IN ('saved','applied','interviewing','rejected','offer')),
    notes          TEXT,
    saved_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT saved_vacancies_user_source_extid_key UNIQUE (user_id, source, external_id)
);
CREATE INDEX idx_saved_vacancies_user
    ON saved_vacancies (user_id, status);
CREATE INDEX idx_saved_vacancies_user_source_extid
    ON saved_vacancies (user_id, source, external_id);

-- ─── podcasts CMS (no seed — 00039 dropped the fakes) ──────
CREATE TABLE podcast_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#6c7af0',
    sort_order  INT  NOT NULL DEFAULT 100,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO podcast_categories (slug, name, color, sort_order) VALUES
    ('system-design', 'System Design', '#7c5cff', 10),
    ('algorithms',    'Algorithms',    '#22c55e', 20),
    ('career',        'Career',        '#f59e0b', 30),
    ('behavioral',    'Behavioral',    '#ec4899', 40),
    ('languages',     'Languages',     '#06b6d4', 50)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE podcasts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_ru      TEXT NOT NULL,
    title_en      TEXT NOT NULL,
    description   TEXT,
    section       TEXT NOT NULL,
    duration_sec  INT NOT NULL,
    audio_key     TEXT NOT NULL,
    is_published  BOOLEAN NOT NULL DEFAULT FALSE,
    host          TEXT,
    category_id   UUID REFERENCES podcast_categories(id) ON DELETE SET NULL,
    episode_num   INT,
    cover_url     TEXT,
    published_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_podcasts_category_id  ON podcasts(category_id);
CREATE INDEX idx_podcasts_published_at ON podcasts(published_at DESC NULLS LAST);

CREATE TABLE podcast_progress (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    podcast_id    UUID NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    listened_sec  INT NOT NULL DEFAULT 0,
    completed_at  TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, podcast_id)
);

-- ─── B2B orgs (HR-tech scaffold) ───────────────────────────
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    owner_user_id   UUID NOT NULL REFERENCES users(id),
    plan            TEXT NOT NULL DEFAULT 'trial',
    seat_quota      INT  NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT organizations_plan_valid
        CHECK (plan IN ('trial','team','growth','enterprise'))
);

CREATE TABLE org_members (
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id),
    CONSTRAINT org_members_role_valid CHECK (role IN ('member','admin','owner'))
);
CREATE INDEX idx_org_members_user ON org_members (user_id);

CREATE TABLE org_seats (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invite_email       TEXT,
    assigned_user_id   UUID REFERENCES users(id),
    status             TEXT NOT NULL DEFAULT 'pending',
    assigned_at        TIMESTAMPTZ,
    revoked_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT org_seats_status_valid CHECK (status IN ('pending','active','revoked'))
);
CREATE INDEX idx_org_seats_org             ON org_seats (org_id);
CREATE INDEX idx_org_seats_assigned_user
    ON org_seats (assigned_user_id) WHERE assigned_user_id IS NOT NULL;

-- ─── Telegram coach link ───────────────────────────────────
CREATE TABLE tg_user_link (
    user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    chat_id        BIGINT NOT NULL UNIQUE,
    tg_username    TEXT,
    linked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    locale         TEXT NOT NULL DEFAULT 'ru',
    push_local_hh  INT  NOT NULL DEFAULT 9,
    push_tz        TEXT NOT NULL DEFAULT 'Europe/Moscow',
    paused_until   TIMESTAMPTZ,
    last_seen_at   TIMESTAMPTZ,
    CONSTRAINT tg_user_link_hh_valid CHECK (push_local_hh BETWEEN 0 AND 23)
);
CREATE INDEX idx_tg_user_link_chat ON tg_user_link(chat_id);

CREATE TABLE tg_link_tokens (
    token       TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);
CREATE INDEX idx_tg_link_tokens_user ON tg_link_tokens(user_id);

-- ─── LLM models registry (admin-editable catalogue) ────────
CREATE TABLE llm_models (
    id                     BIGSERIAL PRIMARY KEY,
    model_id               TEXT        NOT NULL UNIQUE,
    label                  TEXT        NOT NULL,
    provider               TEXT        NOT NULL,
    provider_id            TEXT        NOT NULL DEFAULT 'openrouter',
    is_virtual             BOOLEAN     NOT NULL DEFAULT FALSE,
    tier                   TEXT        NOT NULL DEFAULT 'free',
    is_enabled             BOOLEAN     NOT NULL DEFAULT TRUE,
    context_window         INT,
    cost_per_1k_input_usd  NUMERIC(8,6),
    cost_per_1k_output_usd NUMERIC(8,6),
    use_for_arena          BOOLEAN     NOT NULL DEFAULT TRUE,
    use_for_insight        BOOLEAN     NOT NULL DEFAULT TRUE,
    use_for_mock           BOOLEAN     NOT NULL DEFAULT TRUE,
    use_for_vacancies      BOOLEAN     NOT NULL DEFAULT FALSE,
    sort_order             INT         NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT llm_models_tier_valid CHECK (tier IN ('free','premium'))
);
CREATE INDEX llm_models_enabled_sort_idx ON llm_models (is_enabled, sort_order);

-- Seed consolidated from 00033 + 00044 + 00045/00046.
INSERT INTO llm_models (
    model_id, label, provider, provider_id, tier, is_virtual,
    use_for_arena, use_for_insight, use_for_mock, use_for_vacancies,
    sort_order
) VALUES
    -- druz9 virtual router
    ('druz9/turbo',                        'Турбо ⚡ (авто-роутинг)',         'druz9',     'druz9',      'free',    TRUE,
        TRUE,  TRUE,  TRUE,  TRUE,   1),
    -- OpenRouter-backed (:free lane and paid)
    ('openai/gpt-4o-mini',                 'GPT-4o mini',                    'openai',    'openrouter', 'free',    FALSE,
        TRUE,  TRUE,  TRUE,  TRUE,  10),
    ('qwen/qwen3-coder:free',              'Qwen3 Coder (free)',             'qwen',      'openrouter', 'free',    FALSE,
        FALSE, TRUE,  FALSE, TRUE,  11),
    ('openai/gpt-oss-120b:free',           'GPT-OSS 120B (free)',            'openai',    'openrouter', 'free',    FALSE,
        FALSE, TRUE,  FALSE, FALSE, 12),
    ('minimax/minimax-m2.5:free',          'MiniMax M2.5 (free)',            'minimax',   'openrouter', 'free',    FALSE,
        FALSE, TRUE,  FALSE, FALSE, 13),
    ('liquid/lfm-2.5-1.2b-thinking:free',  'Liquid LFM 2.5 Thinking (free)', 'liquid',    'openrouter', 'free',    FALSE,
        FALSE, TRUE,  FALSE, FALSE, 14),
    ('openai/gpt-4o',                      'GPT-4o',                         'openai',    'openrouter', 'premium', FALSE,
        TRUE,  TRUE,  TRUE,  FALSE, 30),
    ('anthropic/claude-sonnet-4',          'Claude Sonnet 4',                'anthropic', 'openrouter', 'premium', FALSE,
        TRUE,  TRUE,  TRUE,  FALSE, 40),
    ('google/gemini-pro',                  'Gemini Pro',                     'google',    'openrouter', 'premium', FALSE,
        TRUE,  TRUE,  TRUE,  FALSE, 50),
    -- Groq
    ('groq/llama-3.1-8b-instant',          'Llama 3.1 8B (Groq)',            'groq',      'groq',       'free',    FALSE,
        FALSE, FALSE, FALSE, TRUE,  20),
    ('groq/llama-3.3-70b-versatile',       'Llama 3.3 70B (Groq)',           'groq',      'groq',       'free',    FALSE,
        TRUE,  TRUE,  TRUE,  TRUE,  21),
    -- Cerebras
    ('cerebras/llama3.1-8b',               'Llama 3.1 8B (Cerebras)',        'cerebras',  'cerebras',   'free',    FALSE,
        FALSE, FALSE, FALSE, TRUE,  30),
    ('cerebras/llama3.3-70b',              'Llama 3.3 70B (Cerebras)',       'cerebras',  'cerebras',   'free',    FALSE,
        TRUE,  TRUE,  TRUE,  TRUE,  31),
    -- Mistral
    ('mistral/mistral-small-latest',       'Mistral Small (free)',           'mistral',   'mistral',    'free',    FALSE,
        FALSE, FALSE, FALSE, TRUE,  40),
    ('mistral/mistral-large-latest',       'Mistral Large (free)',           'mistral',   'mistral',    'free',    FALSE,
        TRUE,  TRUE,  TRUE,  FALSE, 41),
    -- Legacy mistral-7b row from 00033 — kept for back-compat
    ('mistralai/mistral-7b',               'Mistral 7B',                     'mistral',   'openrouter', 'free',    FALSE,
        TRUE,  TRUE,  TRUE,  FALSE, 22)
ON CONFLICT (model_id) DO NOTHING;

-- ─── Copilot (Cluely-style analyzer + chat) ────────────────
CREATE TABLE copilot_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ,
    byok_only     BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT copilot_sessions_kind_valid CHECK (kind IN ('interview','work','casual'))
);
CREATE INDEX idx_copilot_sessions_user_started
    ON copilot_sessions(user_id, started_at DESC);
CREATE UNIQUE INDEX idx_copilot_sessions_live
    ON copilot_sessions(user_id) WHERE finished_at IS NULL;

CREATE TABLE copilot_conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id      UUID REFERENCES copilot_sessions(id) ON DELETE SET NULL,
    title           TEXT NOT NULL DEFAULT '',
    model           TEXT NOT NULL,
    -- running_summary: конденсат старых turns для sliding-window compaction
    -- (Phase 4). Фоновый compaction-воркер пересчитывает эту колонку, когда
    -- конверсация превышает COMPACTION_THRESHOLD turns. Hot-path строит
    -- prompt как system + running_summary + last_N_turns.
    running_summary TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_copilot_conversations_user_updated
    ON copilot_conversations(user_id, updated_at DESC);
CREATE INDEX idx_copilot_conversations_session
    ON copilot_conversations(session_id) WHERE session_id IS NOT NULL;

CREATE TABLE copilot_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    has_screenshot  BOOLEAN NOT NULL DEFAULT FALSE,
    tokens_in       INT NOT NULL DEFAULT 0,
    tokens_out      INT NOT NULL DEFAULT 0,
    latency_ms      INT NOT NULL DEFAULT 0,
    rating          SMALLINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT copilot_messages_role_valid   CHECK (role IN ('system','user','assistant')),
    CONSTRAINT copilot_messages_rating_valid CHECK (rating IS NULL OR rating IN (-1, 0, 1))
);
CREATE INDEX idx_copilot_messages_conv_created
    ON copilot_messages(conversation_id, created_at);

CREATE TABLE copilot_quotas (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan            TEXT NOT NULL DEFAULT 'free',
    requests_used   INT NOT NULL DEFAULT 0,
    requests_cap    INT NOT NULL DEFAULT 20,
    resets_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 day'),
    models_allowed  TEXT[] NOT NULL DEFAULT ARRAY[
        'druz9/turbo',
        'groq/llama-3.3-70b-versatile',
        'groq/llama-3.1-8b-instant',
        'cerebras/llama3.3-70b',
        'openai/gpt-oss-120b:free',
        'qwen/qwen3-coder:free'
    ]::TEXT[],
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT copilot_quotas_plan_valid CHECK (plan IN ('free','seeker','ascendant'))
);

CREATE TABLE copilot_session_reports (
    session_id        UUID PRIMARY KEY REFERENCES copilot_sessions(id) ON DELETE CASCADE,
    status            TEXT NOT NULL DEFAULT 'pending',
    overall_score     INT NOT NULL DEFAULT 0,
    section_scores    JSONB NOT NULL DEFAULT '{}'::JSONB,
    weaknesses        JSONB NOT NULL DEFAULT '[]'::JSONB,
    recommendations   JSONB NOT NULL DEFAULT '[]'::JSONB,
    links             JSONB NOT NULL DEFAULT '[]'::JSONB,
    report_markdown   TEXT NOT NULL DEFAULT '',
    report_url        TEXT NOT NULL DEFAULT '',
    error_message     TEXT NOT NULL DEFAULT '',
    started_at        TIMESTAMPTZ,
    finished_at       TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    analysis          JSONB NOT NULL DEFAULT '{}'::JSONB,
    title             TEXT  NOT NULL DEFAULT '',
    CONSTRAINT copilot_session_reports_status_valid
        CHECK (status IN ('pending','running','ready','failed'))
);

-- ─── personas (copilot expert-mode prompts) ────────────────
CREATE TABLE personas (
    id              TEXT        PRIMARY KEY,
    label           TEXT        NOT NULL,
    hint            TEXT        NOT NULL DEFAULT '',
    icon_emoji      TEXT        NOT NULL DEFAULT '💬',
    brand_gradient  TEXT        NOT NULL DEFAULT '',
    suggested_task  TEXT        NOT NULL DEFAULT '',
    system_prompt   TEXT        NOT NULL DEFAULT '',
    sort_order      INT         NOT NULL DEFAULT 100,
    is_enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX personas_enabled_sort_idx ON personas (is_enabled, sort_order);

INSERT INTO personas (id, label, hint, icon_emoji, brand_gradient, suggested_task, system_prompt, sort_order) VALUES
    ('default',       'Обычный',        'Без специализации — универсальный режим',
        '💬', 'linear-gradient(135deg, var(--d-accent) 0%, var(--d-accent-2) 100%)',
        '',               '', 10),
    ('react',         'React Expert',   'React · TypeScript · Next.js · performance',
        '⚛️', 'linear-gradient(135deg, #61dafb 0%, #3178c6 100%)',
        'copilot_stream', 'Инструкция: ты senior React-разработчик. Отвечаешь строго в контексте React / TypeScript / Next.js / React Query / Zustand. Всегда показывай рабочий код в fenced-блоке с language-тегом. Упоминай re-render impact, hooks rules, concurrent-режим когда это уместно. Если вопрос вне фронтенд-стека — честно скажи что это не твоя специализация.', 20),
    ('system-design', 'System Design',  'Distributed systems · SRE · capacity planning',
        '🏛️', 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
        'reasoning',      'Инструкция: ты senior system-design интервьюер из FAANG. Отвечаешь по схеме: (1) clarify requirements — что именно строим, какой QPS, SLA, consistency; (2) high-level architecture — компоненты и их API; (3) deep-dives — шардирование, кеш, очереди, репликация; (4) trade-offs — где cut corners на MVP. Числовые прикидки (QPS, storage, bandwidth) обязательно. Рисуй ASCII-диаграммы когда помогает.', 30),
    ('go-sre',        'Go / SRE',       'Go · Kubernetes · observability · incident response',
        '🐹', 'linear-gradient(135deg, #00add8 0%, #5ac8e6 100%)',
        'copilot_stream', 'Инструкция: ты senior Go-разработчик и SRE. Отвечаешь в контексте Go / gRPC / Kubernetes / Prometheus / OpenTelemetry. Для кода — идиоматичный Go с корректной обработкой ошибок (errors.Is/As, wrapping), context-propagation и отсутствием goroutine-ликов. Для infra-вопросов — объясняй через debugging-first lens: какие метрики / логи / traces смотреть, какие k8s-события, как воспроизвести. Ссылайся на конкретные Go-пакеты и k8s-объекты.', 40),
    ('behavioral',    'Behavioral',     'STAR · leadership · conflict · trade-offs',
        '🎭', 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
        'insight_prose',  'Инструкция: ты поведенческий коуч для Big-Tech интервью. Отвечаешь строго по STAR-формату (Situation · Task · Action · Result) когда это ответ на поведенческий вопрос. Фокус на метриках результата, конкретных решениях и lessons learned. Если вопрос — это framework самого интервьюера (тип "how to tell stories"), дай компактный шаблон. Никакой воды; каждое предложение должно нести факт или инструкцию.', 50),
    ('dsa',           'DSA',            'Algorithms · data structures · LeetCode-style problems',
        '🧮', 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
        'copilot_stream', 'Инструкция: ты senior интервьюер по алгоритмам. Отвечаешь по схеме: (1) переформулируй задачу своими словами + edge-cases; (2) brute-force подход + его сложность; (3) оптимальное решение с обоснованием почему именно так; (4) код на Go или Python — выбор по контексту вопроса; (5) анализ time/space complexity строго в O-нотации. Именуй паттерн (two pointers, sliding window, monotonic stack…) явно.', 60)
ON CONFLICT (id) DO NOTHING;

-- ─── dynamic_config seed (moved from 00008_seed_config) ────
INSERT INTO dynamic_config(key, value, type, description) VALUES
  ('arena_workers_count',         to_jsonb(4),     'int',   'Число воркеров матчмейкинга'),
  ('arena_anticheat_threshold',   to_jsonb(70),    'int',   'Порог suspicion score для предупреждения'),
  ('arena_match_confirm_sec',     to_jsonb(10),    'int',   'Окно подтверждения матча (сек)'),
  ('ai_max_concurrent_sessions',  to_jsonb(100),   'int',   'Максимум параллельных AI мок сессий'),
  ('ai_stress_pause_threshold_ms', to_jsonb(120000), 'int', 'Порог паузы для наводящего вопроса'),
  ('elo_k_factor_new',            to_jsonb(32),    'int',   'K-фактор ELO для новичков (< 30 матчей)'),
  ('elo_k_factor_veteran',        to_jsonb(16),    'int',   'K-фактор ELO для ветеранов'),
  ('xp_arena_win',                to_jsonb(120),   'int',   'XP за победу в арене'),
  ('xp_arena_loss',               to_jsonb(20),    'int',   'XP за поражение в арене'),
  ('xp_mock_complete',            to_jsonb(80),    'int',   'XP за завершение AI мока'),
  ('xp_kata_daily',               to_jsonb(30),    'int',   'Базовый XP за Daily Kata'),
  ('xp_kata_cursed_multiplier',   to_jsonb(3),     'int',   'Множитель XP за проклятую Kata'),
  ('skill_decay_days',            to_jsonb(7),     'int',   'Дней без практики до начала деградации'),
  ('skill_decay_rate_pct',        to_jsonb(2),     'int',   'Процент деградации в день'),
  ('guild_max_size',              to_jsonb(10),    'int',   'Максимум участников гильдии'),
  ('season_pass_enabled',         to_jsonb(true),  'bool',  'Включён ли Season Pass'),
  ('voice_mode_enabled',          to_jsonb(false), 'bool',  'Включён ли голосовой мок режим'),
  ('llm_default_free_model',      to_jsonb('openai/gpt-4o-mini'::text), 'string', 'Дефолтная LLM для free'),
  ('llm_default_paid_model',      to_jsonb('openai/gpt-4o'::text),      'string', 'Дефолтная LLM для premium')
ON CONFLICT (key) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;
-- +goose StatementEnd
