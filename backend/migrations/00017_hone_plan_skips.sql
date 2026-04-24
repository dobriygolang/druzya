-- 00017_hone_plan_skips.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Resistance tracker: каждое DismissPlanItem для item'а с непустым skill_key
-- пишет сюда event. Синтезайзер плана читает ChronicSkills (N+ skip'ов за
-- последние M дней) и формирует либо разбиение-на-меньшее, либо reflection-
-- prompt «почему ты избегаешь X?». Без лишних уведомлений — решение встраивается
-- в следующий AI-план, невидимо.
--
-- Не персистим complete-event'ы — они не нужны для этой фичи и плодили бы
-- шум. Если в будущем понадобится «привычки» фича, будет отдельная таблица.
-- ────────────────────────────────────────────────────────────────────────────

-- +goose Up
-- +goose StatementBegin

CREATE TABLE hone_plan_skips (
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_key     text        NOT NULL,
    item_id       text        NOT NULL,
    plan_date     date        NOT NULL,
    dismissed_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, skill_key, item_id, plan_date)
);

-- Покрывает ChronicSkills-запрос: скан по (user, skill) с фильтром по
-- dismissed_at (last M дней).
CREATE INDEX idx_hone_plan_skips_user_skill_time
    ON hone_plan_skips (user_id, skill_key, dismissed_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS hone_plan_skips;
-- +goose StatementEnd
