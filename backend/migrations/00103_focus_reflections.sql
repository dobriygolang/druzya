-- 00103_focus_reflections.sql — H2 (P0) reflection persistence loop.
--
-- Hone pomodoro reflection prompt сейчас собирает grade (1-5) + notes,
-- но в коммент'ах App.tsx есть «фактическое сохранение reflection —
-- отдельная RPC future task». Эта миграция + новая RPC SaveFocusReflection
-- закрывают loop:
--
--   1. Hone end-of-pomodoro UI собирает grade + notes (existing).
--   2. RPC SaveFocusReflection пишет в focus_reflections (durable, queryable).
--   3. Coach next-action prompt читает recent reflections — context'ный совет
--      («previously stuck on X with grade 2 — try Y today»).
--   4. Hone /stats grade-trend chart показывает чёрно-белый тренд.
--
-- Design rationale: новая таблица вместо piggyback на coach_episodes:
--   • Numerical grade + filterable by ended_at — лучше нативная колонка
--     для aggregation queries («avg grade last 30 days»), не jsonb LATERAL.
--   • Idempotency: UNIQUE(user_id, session_id) — Hone outbox replay
--     гарантировано не создаст duplicate row (client retries safe).
--   • Coach memory всё равно получает focus_reflection_added episode через
--     side-effect MemoryWriter в SaveFocusReflection UC — best of both:
--     queryable durable store + Recall surfaces episode в DailyBrief.
--
-- focus_mode CHECK совпадает с hone_focus_mode_valid в 00068 (полный enum).
--
-- Index strategy:
--   • idx_focus_reflections_user_ended — covers 30/90d window + recency sort
--     for both /stats trend chart and next-action prompt context.
--   • UNIQUE(user_id, session_id) — idempotency, наш единственный SELECT
--     "do I already have this?" — covered by the unique index.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE focus_reflections (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- session_id — client-generated UUID matching hone_focus_sessions.id.
    -- Not a FK: focus_reflections может пережить retention drop on focus
    -- sessions (reflection — pure user data, sessions — derived stats).
    session_id       TEXT NOT NULL,
    focus_mode       TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
    -- grade nullable — юзер может submit только notes без оценки.
    -- NULL отдельно от 0 — «no grade» != «very bad».
    grade            SMALLINT CHECK (grade IS NULL OR grade BETWEEN 1 AND 5),
    notes            TEXT NOT NULL DEFAULT '',
    task_pinned      TEXT NOT NULL DEFAULT '',
    started_at       TIMESTAMPTZ NOT NULL,
    ended_at         TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT focus_reflections_mode_valid
        CHECK (focus_mode IN ('pomodoro','stopwatch','free','plan','pinned','countdown')),
    CONSTRAINT focus_reflections_user_session_unique
        UNIQUE (user_id, session_id)
);

CREATE INDEX idx_focus_reflections_user_ended
    ON focus_reflections(user_id, ended_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_focus_reflections_user_ended;
DROP TABLE IF EXISTS focus_reflections;

-- +goose StatementEnd
