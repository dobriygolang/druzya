-- 00013_hone_focus.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Hone desktop-кокпит. Эта миграция покрывает focus-сессии и связанный с
-- ними daily-plan. Notes/Whiteboards — отдельные миграции (00014, 00015)
-- чтобы можно было откатить их независимо (они приватны, focus synkается с
-- web-профилем и логичным образом трогает другую аудиторию таблиц).
--
-- Правило разделения: web (druz9.ru) ПРОИЗВОДИТ контент (задачи, мок,
-- рейтинг). Desktop (Hone) ПОТРЕБЛЯЕТ его и оборачивает в focus-слой. Эти
-- таблицы — «оболочка», не «контент». См. ecosystem.md.
-- ────────────────────────────────────────────────────────────────────────────

-- +goose Up
-- +goose StatementBegin

-- hone_daily_plans — одна запись на (user, date). Генерится AI-синтезом из
-- Skill Atlas + календаря + недавних PR. Кеш: если `regenerated_at` сегодня,
-- не пересчитываем. items — jsonb-массив PlanItem (см hone.proto).
CREATE TABLE hone_daily_plans (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_date       date        NOT NULL,
    items           jsonb       NOT NULL DEFAULT '[]'::jsonb,
    regenerated_at  timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, plan_date)
);

-- Индекс на (user_id, plan_date DESC) покрывает GetDailyPlan (последняя
-- запись) и GetStats (скан за период).
CREATE INDEX idx_hone_daily_plans_user_date ON hone_daily_plans (user_id, plan_date DESC);

-- hone_focus_sessions — pomodoro/stopwatch логи. Одна строка = одна сессия.
-- plan_item_id nullable: можно фокусироваться вне плана (pinned_title тогда
-- несёт свободный заголовок). ON DELETE SET NULL по плану — удаление плана
-- не теряет историю.
CREATE TABLE hone_focus_sessions (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id               uuid        REFERENCES hone_daily_plans(id) ON DELETE SET NULL,
    plan_item_id          text,                     -- opaque id внутри plan.items[]
    pinned_title          text        NOT NULL DEFAULT '',
    mode                  text        NOT NULL CHECK (mode IN ('pomodoro', 'stopwatch')),
    started_at            timestamptz NOT NULL DEFAULT now(),
    ended_at              timestamptz,
    pomodoros_completed   int         NOT NULL DEFAULT 0,
    seconds_focused       int         NOT NULL DEFAULT 0,
    created_at            timestamptz NOT NULL DEFAULT now()
);

-- Покрывает GetStats (heatmap + 7-day bars): скан по (user, started_at DESC).
CREATE INDEX idx_hone_focus_user_started ON hone_focus_sessions (user_id, started_at DESC);

-- hone_streak_days — агрегат по дням, для streak-подсчёта. Отдельная таблица
-- (не рассчитываем на лету из focus_sessions), потому что:
--   1. stats endpoint зовётся на каждом открытии Hone → нужно O(1)
--   2. streak-логика требует транзакционной атомарности (сегодня засчитан?)
--   3. миграция со старого формата streak в daily-домене проще если таблица
--      существует отдельно.
CREATE TABLE hone_streak_days (
    user_id          uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day              date        NOT NULL,
    focused_seconds  int         NOT NULL DEFAULT 0,
    sessions_count   int         NOT NULL DEFAULT 0,
    -- qualifies_streak: день попадает в streak, если focused_seconds >=
    -- порога (дефолт 600 = 10 минут). Порог хранится в коде, не в БД.
    qualifies_streak boolean     NOT NULL DEFAULT false,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day)
);

-- hone_streak_state — сводное состояние streak'а на пользователя. Обновляется
-- транзакционно при завершении focus-сессии.
CREATE TABLE hone_streak_state (
    user_id          uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak   int         NOT NULL DEFAULT 0,
    longest_streak   int         NOT NULL DEFAULT 0,
    last_qualified   date,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS hone_streak_state;
DROP TABLE IF EXISTS hone_streak_days;
DROP TABLE IF EXISTS hone_focus_sessions;
DROP TABLE IF EXISTS hone_daily_plans;
-- +goose StatementEnd
