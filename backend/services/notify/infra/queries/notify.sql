-- notify queries consumed by sqlc (emitted into services/notify/infra/db).

-- name: GetPreferences :one
SELECT user_id, channels, telegram_chat_id, quiet_hours_from, quiet_hours_to,
       weekly_report_enabled, skill_decay_warnings_enabled, updated_at
  FROM notification_preferences
 WHERE user_id = $1;

-- name: UpsertPreferences :one
INSERT INTO notification_preferences (
    user_id, channels, telegram_chat_id,
    quiet_hours_from, quiet_hours_to,
    weekly_report_enabled, skill_decay_warnings_enabled
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
)
ON CONFLICT (user_id) DO UPDATE
    SET channels                     = EXCLUDED.channels,
        telegram_chat_id             = EXCLUDED.telegram_chat_id,
        quiet_hours_from             = EXCLUDED.quiet_hours_from,
        quiet_hours_to               = EXCLUDED.quiet_hours_to,
        weekly_report_enabled        = EXCLUDED.weekly_report_enabled,
        skill_decay_warnings_enabled = EXCLUDED.skill_decay_warnings_enabled,
        updated_at                   = now()
RETURNING user_id, channels, telegram_chat_id, quiet_hours_from, quiet_hours_to,
          weekly_report_enabled, skill_decay_warnings_enabled, updated_at;

-- name: SetTelegramChatID :exec
INSERT INTO notification_preferences (user_id, telegram_chat_id)
VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE
    SET telegram_chat_id = EXCLUDED.telegram_chat_id,
        updated_at       = now();

-- name: ClearTelegramChatID :exec
UPDATE notification_preferences
   SET telegram_chat_id = NULL,
       updated_at       = now()
 WHERE user_id = $1;

-- name: ListWeeklyReportEnabled :many
SELECT user_id
  FROM notification_preferences
 WHERE weekly_report_enabled = TRUE;

-- name: InsertLog :one
INSERT INTO notifications_log (user_id, channel, type, payload, status)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, user_id, channel, type, payload, status, sent_at, error, created_at;

-- name: RecentLogByType :many
SELECT id, user_id, channel, type, payload, status, sent_at, error, created_at
  FROM notifications_log
 WHERE user_id = $1
   AND type    = $2
   AND created_at >= $3
 ORDER BY created_at DESC
 LIMIT 10;

-- name: MarkLogSent :exec
UPDATE notifications_log
   SET status  = 'sent',
       sent_at = $2
 WHERE id = $1;

-- name: MarkLogFailed :exec
UPDATE notifications_log
   SET status = 'failed',
       error  = $2
 WHERE id = $1;

-- name: FindUserIDByUsername :one
SELECT id
  FROM users
 WHERE username = $1;

-- name: GetUserLocale :one
SELECT locale
  FROM users
 WHERE id = $1;
