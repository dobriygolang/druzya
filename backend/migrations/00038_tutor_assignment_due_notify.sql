-- 00038_tutor_assignment_due_notify.sql — track which assignments already
-- got their «due in 24h» notification sent. Cron sweeps the table; without
-- this column we'd send the same notification every run.
--
-- NULL = not yet notified. Stamped UTC timestamp = «pinged at this moment».
-- Не делаем boolean: timestamp полезен для аудита («когда мы дёрнули notify
-- service») и для re-notify guard (последний раз не далее N часов назад).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE tutor_assignments
    ADD COLUMN IF NOT EXISTS due_notified_at TIMESTAMPTZ;

-- Partial index ускоряет cron-скан: WHERE due_at IS NOT NULL AND completed_at IS NULL
-- AND archived_at IS NULL AND due_notified_at IS NULL — exactly эти строки.
CREATE INDEX IF NOT EXISTS idx_tutor_assignments_due_pending_notify
    ON tutor_assignments (due_at)
    WHERE due_at IS NOT NULL
      AND due_notified_at IS NULL
      AND completed_at IS NULL
      AND archived_at IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_tutor_assignments_due_pending_notify;
ALTER TABLE tutor_assignments DROP COLUMN IF EXISTS due_notified_at;
-- +goose StatementEnd
