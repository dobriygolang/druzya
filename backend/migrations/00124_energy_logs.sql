-- 00122_energy_logs.sql — Phase K Wave 15 (2026-05-14)
--
-- Energy tracker для Hone. Юзер тэгает уровень энергии 1-5 раз в N часов
-- (вручную или по soft-nudge). Накапливается → через неделю видны
-- паттерны (утро высокая, обед падает, вечер второе дыхание). Помогает
-- планировать сложные задачи на пик энергии в time-blocking UI.
--
-- Schema:
--   id          UUID — PK.
--   user_id     UUID — FK users.id ON DELETE CASCADE (личные данные).
--   logged_at   TIMESTAMPTZ NOT NULL — момент замера (server now() default,
--               клиент может явно задать через outbox replay).
--   level       SMALLINT 1..5 — субъективная шкала
--               (1 = выжат, 3 = норма, 5 = пиковая).
--   note        TEXT — опциональный комментарий («после обеда»,
--               «выспался», «недосып»). NULL когда юзер тапнул только цифру.
--
-- Index strategy:
--   • idx_energy_logs_user_logged (user_id, logged_at DESC) — covers
--     «последние N дней» read path; recency-sort встроен в индекс.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE energy_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    level      SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 5),
    note       TEXT
);

CREATE INDEX idx_energy_logs_user_logged
    ON energy_logs (user_id, logged_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_energy_logs_user_logged;
DROP TABLE IF EXISTS energy_logs;

-- +goose StatementEnd
