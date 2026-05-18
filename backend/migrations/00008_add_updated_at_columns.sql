-- Добавляет updated_at в таблицы, где строки реально мутируются, но
-- колонки не было. Без неё read-side (admin UI / sync workers / audit)
-- не может определить «когда последний раз изменили».
--
-- Покрытие:
--   editor_participants — role переключается owner ↔ participant
--   editor_rooms        — code (Yjs doc) и archived_at меняются
--   eval_runs           — summary/parsed_ok обновляются после повторного парса
--
-- DEFAULT now() заполняет существующие строки текущим временем — лучше,
-- чем NULL, и не требует backfill'а в коде. NOT NULL не ставим: legacy
-- read-paths сразу полагающиеся на ≥ created_at могут возвращать «никогда
-- не обновлялось» через nil.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE public.editor_participants
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.editor_rooms
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.eval_runs
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE public.editor_participants DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.editor_rooms DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.eval_runs DROP COLUMN IF EXISTS updated_at;
-- +goose StatementEnd
