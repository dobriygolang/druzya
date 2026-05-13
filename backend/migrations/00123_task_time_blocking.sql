-- 00121_task_time_blocking.sql — Phase K Wave 15 (2026-05-14)
--
-- Time-blocking surface для Hone TaskBoard. Раньше карточки жили в
-- статичных kanban-колонках (todo/in_progress/in_review/done). Теперь
-- юзер может перетащить карточку из бэклога в часовой слот в day view —
-- получается календарь сегодняшнего дня. Видно сколько часов запланировано,
-- помещается ли всё в день.
--
-- Schema:
--   scheduled_start         TIMESTAMPTZ — момент начала блока (UTC); NULL = не
--                           запланирован, живёт в обычной TaskBoard-колонке.
--   scheduled_duration_min  INT — длительность в минутах (15-минутный grid в UI);
--                           NULL когда scheduled_start NULL.
--
-- Index strategy:
--   • idx_hone_tasks_scheduled_start — partial WHERE scheduled_start NOT NULL,
--     supports «day view» query «WHERE user_id = $1 AND scheduled_start::date = $2».
--     Partial keeps the index ~tiny: только запланированные карточки.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE hone_tasks
    ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scheduled_duration_min INT;

CREATE INDEX IF NOT EXISTS idx_hone_tasks_scheduled_start
    ON hone_tasks (user_id, scheduled_start)
    WHERE scheduled_start IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_hone_tasks_scheduled_start;

ALTER TABLE hone_tasks
    DROP COLUMN IF EXISTS scheduled_start,
    DROP COLUMN IF EXISTS scheduled_duration_min;

-- +goose StatementEnd
