// postgres_user_notifications.go — реализация UserNotificationRepo + PrefsRepo
// поверх pgxpool без sqlc (две таблицы — overkill для генерации).
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/notify/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UserNotifPostgres реализует domain.UserNotificationRepo.
type UserNotifPostgres struct {
	pool *pgxpool.Pool
}

// NewUserNotifPostgres конструктор.
func NewUserNotifPostgres(pool *pgxpool.Pool) *UserNotifPostgres {
	return &UserNotifPostgres{pool: pool}
}

// Insert вставляет новую запись и возвращает её с заполненными id/created_at.
func (p *UserNotifPostgres) Insert(ctx context.Context, n domain.UserNotification) (domain.UserNotification, error) {
	var payload []byte
	if n.Payload != nil {
		var err error
		payload, err = json.Marshal(n.Payload)
		if err != nil {
			return domain.UserNotification{}, fmt.Errorf("notify.user.Insert.marshal: %w", err)
		}
	}
	row := p.pool.QueryRow(ctx, `
		INSERT INTO user_notifications
		   (user_id, channel, type, title, body, payload, priority)
		VALUES
		   ($1, $2, $3, $4, NULLIF($5, ''), $6, $7)
		RETURNING id, created_at
	`, n.UserID, n.Channel, n.Type, n.Title, n.Body, payload, n.Priority)
	if err := row.Scan(&n.ID, &n.CreatedAt); err != nil {
		return domain.UserNotification{}, fmt.Errorf("notify.user.Insert: %w", err)
	}
	return n, nil
}

// ListByUser возвращает страницу по фильтру.
func (p *UserNotifPostgres) ListByUser(ctx context.Context, uid uuid.UUID, f domain.NotificationFilter) ([]domain.UserNotification, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	channelClause := ""
	args := []any{uid}
	argi := 2
	if f.Channel != "" {
		channelClause = fmt.Sprintf("AND channel = $%d", argi)
		args = append(args, f.Channel)
		argi++
	}
	unreadClause := ""
	if f.OnlyUnread {
		unreadClause = "AND read_at IS NULL"
	}
	beforeClause := ""
	if !f.Before.IsZero() {
		beforeClause = fmt.Sprintf("AND created_at < $%d", argi)
		args = append(args, f.Before)
		argi++
	}
	args = append(args, int32(limit))
	q := fmt.Sprintf(`
		SELECT id, user_id, channel, type, title, COALESCE(body, ''),
		       payload, priority, read_at, created_at
		  FROM user_notifications
		 WHERE user_id = $1 %s %s %s
		 ORDER BY created_at DESC
		 LIMIT $%d
	`, channelClause, unreadClause, beforeClause, argi)
	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("notify.user.ListByUser: %w", err)
	}
	defer rows.Close()
	out := make([]domain.UserNotification, 0, limit)
	for rows.Next() {
		var (
			n       domain.UserNotification
			payload []byte
			readAt  nullableTime2
		)
		if err := rows.Scan(&n.ID, &n.UserID, &n.Channel, &n.Type, &n.Title, &n.Body,
			&payload, &n.Priority, &readAt, &n.CreatedAt); err != nil {
			return nil, fmt.Errorf("notify.user.ListByUser: scan: %w", err)
		}
		if readAt.Valid {
			t := readAt.Time
			n.ReadAt = &t
		}
		if len(payload) > 0 {
			var m map[string]any
			if err := json.Unmarshal(payload, &m); err == nil {
				n.Payload = m
			}
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("notify.user.ListByUser: rows: %w", err)
	}
	return out, nil
}

// MarkRead — UPDATE одной строки.
func (p *UserNotifPostgres) MarkRead(ctx context.Context, id int64, uid uuid.UUID) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE user_notifications
		   SET read_at = now()
		 WHERE id = $1 AND user_id = $2 AND read_at IS NULL
	`, id, uid)
	if err != nil {
		return fmt.Errorf("notify.user.MarkRead: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// уже прочитана или не наша — это не ошибка
		return nil
	}
	return nil
}

// MarkAllRead — UPDATE всех непрочитанных. Возвращает количество.
func (p *UserNotifPostgres) MarkAllRead(ctx context.Context, uid uuid.UUID) (int64, error) {
	tag, err := p.pool.Exec(ctx, `
		UPDATE user_notifications
		   SET read_at = now()
		 WHERE user_id = $1 AND read_at IS NULL
	`, uid)
	if err != nil {
		return 0, fmt.Errorf("notify.user.MarkAllRead: %w", err)
	}
	return tag.RowsAffected(), nil
}

// CountUnread — count(*) where read_at is null.
func (p *UserNotifPostgres) CountUnread(ctx context.Context, uid uuid.UUID) (int, error) {
	var n int
	row := p.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		  FROM user_notifications
		 WHERE user_id = $1 AND read_at IS NULL
	`, uid)
	if err := row.Scan(&n); err != nil {
		return 0, fmt.Errorf("notify.user.CountUnread: %w", err)
	}
	return n, nil
}

// Compile-time guard.
var _ domain.UserNotificationRepo = (*UserNotifPostgres)(nil)

// ── PrefsRepo ───────────────────────────────────────────────────────────────

// PrefsPostgres реализует domain.NotificationPrefsRepo.
type PrefsPostgres struct {
	pool *pgxpool.Pool
}

// NewPrefsPostgres конструктор.
func NewPrefsPostgres(pool *pgxpool.Pool) *PrefsPostgres {
	return &PrefsPostgres{pool: pool}
}

// Get загружает prefs или возвращает дефолтную пустую.
func (p *PrefsPostgres) Get(ctx context.Context, uid uuid.UUID) (domain.NotificationPrefs, error) {
	row := p.pool.QueryRow(ctx, `
		SELECT user_id, channel_enabled, silence_until, updated_at
		  FROM notification_prefs
		 WHERE user_id = $1
	`, uid)
	var (
		out          domain.NotificationPrefs
		channelJSON  []byte
		silenceUntil nullableTime2
	)
	if err := row.Scan(&out.UserID, &channelJSON, &silenceUntil, &out.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.NotificationPrefs{UserID: uid, ChannelEnabled: map[string]bool{}}, nil
		}
		return domain.NotificationPrefs{}, fmt.Errorf("notify.prefs.Get: %w", err)
	}
	if silenceUntil.Valid {
		t := silenceUntil.Time
		out.SilenceUntil = &t
	}
	out.ChannelEnabled = map[string]bool{}
	if len(channelJSON) > 0 {
		_ = json.Unmarshal(channelJSON, &out.ChannelEnabled)
	}
	return out, nil
}

// Upsert вставляет/обновляет.
func (p *PrefsPostgres) Upsert(ctx context.Context, prefs domain.NotificationPrefs) (domain.NotificationPrefs, error) {
	if prefs.ChannelEnabled == nil {
		prefs.ChannelEnabled = map[string]bool{}
	}
	channelJSON, err := json.Marshal(prefs.ChannelEnabled)
	if err != nil {
		return domain.NotificationPrefs{}, fmt.Errorf("notify.prefs.Upsert.marshal: %w", err)
	}
	var silenceUntil any
	if prefs.SilenceUntil != nil {
		silenceUntil = prefs.SilenceUntil
	}
	row := p.pool.QueryRow(ctx, `
		INSERT INTO notification_prefs (user_id, channel_enabled, silence_until)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		   SET channel_enabled = EXCLUDED.channel_enabled,
		       silence_until = EXCLUDED.silence_until,
		       updated_at = now()
		RETURNING user_id, channel_enabled, silence_until, updated_at
	`, prefs.UserID, channelJSON, silenceUntil)
	var (
		out         domain.NotificationPrefs
		channelOut  []byte
		silenceTime nullableTime2
	)
	if err := row.Scan(&out.UserID, &channelOut, &silenceTime, &out.UpdatedAt); err != nil {
		return domain.NotificationPrefs{}, fmt.Errorf("notify.prefs.Upsert: %w", err)
	}
	out.ChannelEnabled = map[string]bool{}
	_ = json.Unmarshal(channelOut, &out.ChannelEnabled)
	if silenceTime.Valid {
		t := silenceTime.Time
		out.SilenceUntil = &t
	}
	return out, nil
}

// Compile-time guard.
var _ domain.NotificationPrefsRepo = (*PrefsPostgres)(nil)

// ── helpers ────────────────────────────────────────────────────────────────

// nullableTime2 — локальная копия nullableTime (есть в support_handler), чтобы
// не плодить cross-file dependencies.
type nullableTime2 struct {
	Time  time.Time
	Valid bool
}

func (n *nullableTime2) Scan(src any) error {
	if src == nil {
		n.Valid = false
		return nil
	}
	switch v := src.(type) {
	case time.Time:
		n.Time = v.UTC()
		n.Valid = true
	default:
		return fmt.Errorf("notify.user.scan time: unsupported type %T", src)
	}
	return nil
}
