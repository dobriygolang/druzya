-- notify queries consumed by sqlc (emitted into services/notify/infra/db).
--
-- v2:
--   * notification_preferences merged into notification_prefs (single table)
--   * notifications_log dropped (was event-log, nobody reads)
--   * channels[] / quiet_hours_* removed (channel state lives in
--     channel_enabled jsonb; quiet hours are silence_until timestamptz)

-- name: GetPreferences :one
SELECT user_id, telegram_chat_id, channel_enabled,
       weekly_report_enabled, skill_decay_warnings_enabled,
       silence_until, updated_at
  FROM notification_prefs
 WHERE user_id = $1;

-- name: UpsertPreferences :one
INSERT INTO notification_prefs (
    user_id, telegram_chat_id, channel_enabled,
    weekly_report_enabled, skill_decay_warnings_enabled,
    silence_until
) VALUES (
    $1, $2, $3, $4, $5, $6
)
ON CONFLICT (user_id) DO UPDATE
    SET telegram_chat_id             = EXCLUDED.telegram_chat_id,
        channel_enabled              = EXCLUDED.channel_enabled,
        weekly_report_enabled        = EXCLUDED.weekly_report_enabled,
        skill_decay_warnings_enabled = EXCLUDED.skill_decay_warnings_enabled,
        silence_until                = EXCLUDED.silence_until,
        updated_at                   = now()
RETURNING user_id, telegram_chat_id, channel_enabled,
          weekly_report_enabled, skill_decay_warnings_enabled,
          silence_until, updated_at;

-- name: SetTelegramChatID :exec
INSERT INTO notification_prefs (user_id, telegram_chat_id)
VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE
    SET telegram_chat_id = EXCLUDED.telegram_chat_id,
        updated_at       = now();

-- name: ClearTelegramChatID :exec
UPDATE notification_prefs
   SET telegram_chat_id = NULL,
       updated_at       = now()
 WHERE user_id = $1;

-- name: ListWeeklyReportEnabled :many
SELECT user_id
  FROM notification_prefs
 WHERE weekly_report_enabled = TRUE;

-- name: FindUserIDByUsername :one
SELECT id
  FROM users
 WHERE username = $1;

-- name: GetUserLocale :one
SELECT locale
  FROM users
 WHERE id = $1;
