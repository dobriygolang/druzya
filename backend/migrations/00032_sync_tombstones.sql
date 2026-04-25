-- +goose Up
-- +goose StatementBegin
--
-- Phase C-4: sync_tombstones — журнал удалений для cross-device sync.
--
-- Зачем: pull endpoint возвращает «что изменилось с cursor». Для
-- updated rows смотрим updated_at > cursor. Для УДАЛЁННЫХ строк нет
-- updated_at (строка исчезла), поэтому держим отдельный журнал
-- tombstones — каждое DELETE пишет одну запись.
--
-- Жизненный цикл:
--   1. DeleteNote / DeleteWhiteboard / etc в той же TX вставляют tombstone.
--   2. Pull-endpoint scan'ит deleted_at > cursor и отдаёт {table, row_id}.
--   3. Frontend применяет — удаляет row из локального cache.
--   4. GC cron раз в сутки чистит старше 90 дней (любое устройство
--      offline дольше получает 409 Resync и делает full bootstrap).
--
-- Не используем триггер на DELETE по двум причинам:
--   (a) Hone repos владеют контролем — explicit insert чётче чем
--       implicit trigger (debugging проще).
--   (b) Some deletes не должны попадать в tombstone (например, если
--       admin вручную чистит test-юзера). Trigger lock'нет это в
--       железо; explicit call даёт нам опт-аут возможность.
CREATE TABLE sync_tombstones (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    table_name  TEXT NOT NULL,
    row_id      UUID NOT NULL,
    deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- device_id источника удаления — чтобы pull-endpoint мог отфильтровать
    -- запрашивающее устройство (не возвращать ему его же tombstone'ы).
    -- nullable: legacy delete'ы без X-Device-ID (auto-cron, admin tools).
    origin_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    CONSTRAINT sync_tombstone_table_valid CHECK (
        table_name IN (
            'hone_notes',
            'hone_whiteboards',
            'hone_focus_sessions',
            'hone_plans',
            'coach_episodes'
        )
    )
);

-- Hot-path: pull endpoint фильтрует по (user_id, deleted_at >  cursor).
CREATE INDEX idx_sync_tombstones_user_time
    ON sync_tombstones(user_id, deleted_at);

-- GC cron сканит старее 90 дней.
CREATE INDEX idx_sync_tombstones_deleted_at
    ON sync_tombstones(deleted_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS sync_tombstones;
-- +goose StatementEnd
