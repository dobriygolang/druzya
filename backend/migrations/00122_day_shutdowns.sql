-- 00120_day_shutdowns.sql — Phase K Wave 15: End-of-day shutdown ritual.
--
-- Hone shows a quiet 21:00 reminder («Заверши день — 60 секунд»). Click ⇒
-- modal with 3 textareas: what got done / what's pending / what matters tomorrow.
-- Submit ⇒ row in day_shutdowns. Утром daily_brief use case (intelligence)
-- читает последнюю запись и кормит coach prompt секцией DAY SHUTDOWN, чтобы
-- coach видел «вчера юзер закончил X, висит Y, на сегодня важно Z».
--
-- Design rationale:
--   • Отдельная таблица (а не focus_reflections / coach_episodes) — три поля
--     с разной семантикой проще читать кодом и из UI чем jsonb sub-record.
--   • UNIQUE(user_id, shutdown_date) — если юзер случайно нажал кнопку
--     дважды, upsert (ON CONFLICT) перезаписывает, а не плодит дубль.
--   • DATE (а не TIMESTAMPTZ) — shutdown логически привязан к календарному
--     дню, не к моменту. «Заверши день за 2024-05-14» — день один, неважно
--     закрыл в 21:00 или в 23:55.
--
-- Index: idx_day_shutdowns_user_date — единственный hot path («дай мне
-- shutdown за вчера для daily_brief»). DESC по дате, latest-first lookup.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE day_shutdowns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shutdown_date   DATE NOT NULL,
    done            TEXT NOT NULL DEFAULT '',
    pending         TEXT NOT NULL DEFAULT '',
    tomorrow        TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT day_shutdowns_user_date_unique
        UNIQUE (user_id, shutdown_date)
);

CREATE INDEX idx_day_shutdowns_user_date
    ON day_shutdowns(user_id, shutdown_date DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_day_shutdowns_user_date;
DROP TABLE IF EXISTS day_shutdowns;

-- +goose StatementEnd
