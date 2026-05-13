-- 00120_resistance_journal.sql — Phase K Wave 15 «Resistance journal».
--
-- Pre-focus 10-second prompt «что трудно прямо сейчас?». Optional — юзер
-- может пропустить (Enter / Esc). Если ввёл — запись падает в этот лог.
-- Раз в неделю coach next-action use case читает агрегированные записи
-- и упоминает паттерны («ты три раза за неделю упомянул, что трудно
-- начать system-design — давай сегодня…»).
--
-- Не путать с существующим `hone_plan_skips` (а.к.а. ResistanceRepo в Go):
-- тот трекает chronic-skip skill items по skill_key. Здесь — журнал
-- свободного текста, не привязанный к skill atlas.
--
-- focus_session_id / task_id — nullable links. Когда юзер начинает
-- pomodoro «free» mode без pinned задачи — оба пусты; когда стартует
-- с pinned task — заполняем оба, чтобы при ретроспективе можно было
-- сопоставить «трудно начать» → «не закончил» → «отмёл задачу».
--
-- Retention: 90 дней через telemetry-style prune job (не enforce'им CHECK
-- ради soft-rollback на длинные периоды). MVP: live forever, prune задача
-- появится одновременно с retention для других user-text таблиц.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE resistance_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- text — что юзер написал. Trim'нутый на app-уровне; пустые строки не
    -- допускаются — frontend не отправляет, защитный CHECK на DB-стороне.
    text             TEXT NOT NULL CHECK (length(text) > 0),
    -- focus_session_id — UUID hone_focus_sessions.id when journal recorded
    -- right before a Start. NULL когда юзер открыл modal через ⌘-shortcut
    -- standalone (не в составе focus-start flow). Не FK: focus_sessions
    -- может быть retention-dropped, журнал переживает.
    focus_session_id UUID,
    -- task_id — UUID hone_tasks.id когда фокус был на конкретной задаче
    -- (Start с pinned task). Опять не FK по тем же причинам.
    task_id          UUID
);

-- Recency-первый scan для weekly digest и Coach context. 7-30 дней —
-- основное окно чтения, DESC покрывает оба.
CREATE INDEX idx_resistance_log_user_logged
    ON resistance_log(user_id, logged_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_resistance_log_user_logged;
DROP TABLE IF EXISTS resistance_log;

-- +goose StatementEnd
