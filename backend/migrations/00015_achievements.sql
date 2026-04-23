-- +goose Up
-- user_achievements хранит per-user прогресс по ачивкам.
-- Каталог ачивок описан в коде (services/achievements/domain/catalogue.go),
-- т.к. контент-команда обещала переехать на админ-CMS позже — отдельная
-- таблица с дублирующими константами не нужна.
--
-- progress + target денормализованы — позволяет UI рисовать "12/30" без
-- лишнего join к каталогу. Каталог отдаёт target по умолчанию, но реальный
-- target в строке выигрывает (переопределение через сезон/event).
--
-- unlocked_at IS NULL ⇒ ачивка ещё в прогрессе. Уникальный индекс
-- (user_id, code) гарантирует один прогресс на пару.
CREATE TABLE IF NOT EXISTS user_achievements (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT NOT NULL,
    progress    INT NOT NULL DEFAULT 0,
    target      INT NOT NULL DEFAULT 1,
    unlocked_at TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, code)
);

CREATE INDEX IF NOT EXISTS idx_user_ach_user
    ON user_achievements (user_id, unlocked_at DESC NULLS LAST);

-- +goose Down
DROP INDEX IF EXISTS idx_user_ach_user;
DROP TABLE IF EXISTS user_achievements;
