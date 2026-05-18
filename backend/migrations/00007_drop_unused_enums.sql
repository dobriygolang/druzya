-- Удаляет ENUM-типы от давно вырезанных доменов (clubs, personal_events).
-- Ни одна таблица в baseline не ссылается на них — это чистый mortgage.

-- +goose Up
-- +goose StatementBegin
DROP TYPE IF EXISTS public.club_attendee_status;
DROP TYPE IF EXISTS public.club_session_status;
DROP TYPE IF EXISTS public.personal_event_kind;
DROP TYPE IF EXISTS public.personal_event_reminder_horizon;
DROP TYPE IF EXISTS public.personal_event_status;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- IRRECOVERABLE: восстановление типов потребует ручной правки baseline.
SELECT 1;
-- +goose StatementEnd
