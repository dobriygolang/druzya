-- +goose Up
-- +goose StatementBegin
-- Security hotfix (2026-04-24): telegram_chat_id в notification_preferences
-- не был UNIQUE. Баг в bot_dispatcher.handleLink позволял ЛЮБОМУ пользователю
-- Telegram выставить свой chat_id для ЧУЖОГО druz9-аккаунта (через /link
-- <username>), что приводило к тому что уведомления жертвы попадали в чат
-- атакующего. Также из-за race condition мог случайно получиться дубль
-- даже при легитимном сценарии.
--
-- Шаги:
--   1. Зачищаем существующие дубликаты по telegram_chat_id. Оставляем
--      самую свежую привязку по updated_at, остальным обнуляем chat_id
--      (эти пользователи потеряют Telegram-уведомления и должны заново
--      привязать через legitimate deep-link flow).
--   2. Создаём partial UNIQUE index — защита на уровне БД.
--
-- Partial (WHERE telegram_chat_id IS NOT NULL) — NULL не считаются
-- "равными" в UNIQUE, но делаем явно для читаемости и для BTREE-compatible
-- подстановки.
WITH ranked AS (
    SELECT user_id,
           telegram_chat_id,
           ROW_NUMBER() OVER (
               PARTITION BY telegram_chat_id
               ORDER BY updated_at DESC, user_id
           ) AS rn
      FROM notification_preferences
     WHERE telegram_chat_id IS NOT NULL
)
UPDATE notification_preferences np
   SET telegram_chat_id = NULL,
       updated_at       = now()
  FROM ranked
 WHERE np.user_id = ranked.user_id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_prefs_chat_id_unique
    ON notification_preferences (telegram_chat_id)
 WHERE telegram_chat_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_notification_prefs_chat_id_unique;
-- Данные не восстанавливаются (dedup сделан деструктивно).
-- +goose StatementEnd
