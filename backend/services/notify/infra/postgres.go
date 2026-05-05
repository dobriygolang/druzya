// Package infra holds Postgres, Redis, and HTTP adapters for the notify domain.
//
// v2 changes:
//   - notifications_log dropped → LogRepo interface gone, send-attempts no
//     longer persisted (telegram-bot rate limiter handles dedup in Redis)
//   - notification_preferences merged into notification_prefs:
//   - channels[] / quiet_hours_* columns gone
//   - channel_enabled jsonb is the channel toggle
//   - quiet_hours_* (if needed later) re-implement via silence_until
//   - QuietHours kept in domain as a runtime-only window (Set=false reads
//     skip the gate) so the service.go logic doesn't need a rewrite
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"druz9/notify/domain"
	notifydb "druz9/notify/infra/db"
	"druz9/shared/enums"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.PreferencesRepo and domain.UserLookup.
// LogRepo is no longer persisted (notifications_log dropped in schema_v2).
type Postgres struct {
	pool *pgxpool.Pool
	q    *notifydb.Queries
}

// NewPostgres constructs the Postgres adapter.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: notifydb.New(pool)}
}

// ── PreferencesRepo ─────────────────────────────────────────────────────────

// Get loads a preferences row.
func (p *Postgres) Get(ctx context.Context, userID uuid.UUID) (domain.Preferences, error) {
	row, err := p.q.GetPreferences(ctx, sharedpg.UUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Preferences{UserID: userID}, domain.ErrNotFound
		}
		return domain.Preferences{}, fmt.Errorf("notify.pg.Get: %w", err)
	}
	return toPreferences(row), nil
}

// Upsert persists a preferences row and returns the authoritative copy.
// channel_enabled is encoded from the in-memory Channels list to keep the
// service-layer API stable.
func (p *Postgres) Upsert(ctx context.Context, pref domain.Preferences) (domain.Preferences, error) {
	enabled, err := json.Marshal(channelsToEnabledMap(pref.Channels))
	if err != nil {
		return domain.Preferences{}, fmt.Errorf("notify.pg.Upsert: encode channels: %w", err)
	}
	params := notifydb.UpsertPreferencesParams{
		UserID:                    sharedpg.UUID(pref.UserID),
		TelegramChatID:            pgText(pref.TelegramChatID),
		ChannelEnabled:            enabled,
		WeeklyReportEnabled:       pref.WeeklyReportEnabled,
		SkillDecayWarningsEnabled: pref.SkillDecayWarningsEnabled,
		SilenceUntil:              pgtype.Timestamptz{}, // not exposed via Preferences; cleared on every upsert for now.
	}
	row, err := p.q.UpsertPreferences(ctx, params)
	if err != nil {
		return domain.Preferences{}, fmt.Errorf("notify.pg.Upsert: %w", err)
	}
	return toPreferences(row), nil
}

// SetTelegramChatID stores the chat_id reported by the bot /link flow.
func (p *Postgres) SetTelegramChatID(ctx context.Context, userID uuid.UUID, chatID string) error {
	if err := p.q.SetTelegramChatID(ctx, notifydb.SetTelegramChatIDParams{
		UserID:         sharedpg.UUID(userID),
		TelegramChatID: pgText(chatID),
	}); err != nil {
		return fmt.Errorf("notify.pg.SetTelegramChatID: %w", err)
	}
	return nil
}

// ClearTelegramChatID nulls out the chat_id (called by /unlink).
func (p *Postgres) ClearTelegramChatID(ctx context.Context, userID uuid.UUID) error {
	if err := p.q.ClearTelegramChatID(ctx, sharedpg.UUID(userID)); err != nil {
		return fmt.Errorf("notify.pg.ClearTelegramChatID: %w", err)
	}
	return nil
}

// ListWeeklyReportEnabled returns the subscribers for the weekly report job.
func (p *Postgres) ListWeeklyReportEnabled(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := p.q.ListWeeklyReportEnabled(ctx)
	if err != nil {
		return nil, fmt.Errorf("notify.pg.ListWeeklyReportEnabled: %w", err)
	}
	out := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		out = append(out, sharedpg.UUIDFrom(r))
	}
	return out, nil
}

// ListWeeklyReportEnabledChunked — chunked-fetch вариант для scheduler'а.
// Загружает batch'ами (default 1000) пока не закончатся; передаёт каждый
// batch в visit(). Прерывается при visit-ошибке или ctx.Cancel'е.
//
// R4 perf: ListWeeklyReportEnabled на 100K subscribers держит весь slice
// в памяти и блокирует запрос на full-table scan. Chunked path стримит
// batches → меньшее давление на пул + scheduler может начать fan-out
// раньше чем всё прогружено.
//
// Использует raw SQL (sqlc-generated query — non-paginated). Hand-rolled
// keyset запрос: WHERE user_id > last ORDER BY user_id LIMIT N.
func (p *Postgres) ListWeeklyReportEnabledChunked(ctx context.Context, chunkSize int, visit func(batch []uuid.UUID) error) error {
	if chunkSize <= 0 {
		chunkSize = 1000
	}
	last := uuid.Nil
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		rows, err := p.pool.Query(ctx,
			`SELECT user_id FROM notification_prefs
			 WHERE weekly_report_enabled = TRUE AND user_id > $1
			 ORDER BY user_id ASC
			 LIMIT $2`,
			sharedpg.UUID(last), chunkSize,
		)
		if err != nil {
			return fmt.Errorf("notify.pg.ListWeeklyReportEnabledChunked: %w", err)
		}
		batch := make([]uuid.UUID, 0, chunkSize)
		for rows.Next() {
			var u pgtype.UUID
			if err := rows.Scan(&u); err != nil {
				rows.Close()
				return fmt.Errorf("notify.pg.ListWeeklyReportEnabledChunked: scan: %w", err)
			}
			batch = append(batch, sharedpg.UUIDFrom(u))
		}
		closeErr := rows.Err()
		rows.Close()
		if closeErr != nil {
			return fmt.Errorf("notify.pg.ListWeeklyReportEnabledChunked: rows: %w", closeErr)
		}
		if len(batch) == 0 {
			return nil
		}
		if err := visit(batch); err != nil {
			return err
		}
		last = batch[len(batch)-1]
		if len(batch) < chunkSize {
			return nil
		}
	}
}

// ── UserLookup ──────────────────────────────────────────────────────────────

// FindIDByUsername resolves username → user_id. Used by /link.
func (p *Postgres) FindIDByUsername(ctx context.Context, username string) (uuid.UUID, error) {
	id, err := p.q.FindUserIDByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, domain.ErrNotFound
		}
		return uuid.Nil, fmt.Errorf("notify.pg.FindIDByUsername: %w", err)
	}
	return sharedpg.UUIDFrom(id), nil
}

// GetLocale returns the user's locale (defaults to "ru").
func (p *Postgres) GetLocale(ctx context.Context, userID uuid.UUID) (string, error) {
	loc, err := p.q.GetUserLocale(ctx, sharedpg.UUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "ru", nil
		}
		return "ru", fmt.Errorf("notify.pg.GetLocale: %w", err)
	}
	if loc == "" {
		return "ru", nil
	}
	return loc, nil
}

// Compile-time assertions.
var (
	_ domain.PreferencesRepo = (*Postgres)(nil)
	_ domain.UserLookup      = (*Postgres)(nil)
)

// ── helpers ────────────────────────────────────────────────────────────────

func pgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: s, Valid: true}
}

// channelsToEnabledMap converts the in-memory Channels slice into the
// channel_enabled jsonb shape: {"telegram": true, "in_app": true, ...}.
// An empty slice falls back to telegram-only (the v2 default).
func channelsToEnabledMap(cs []enums.NotificationChannel) map[string]bool {
	if len(cs) == 0 {
		return map[string]bool{string(enums.NotificationChannelTelegram): true}
	}
	out := make(map[string]bool, len(cs))
	for _, c := range cs {
		out[string(c)] = true
	}
	return out
}

// enabledMapToChannels parses the jsonb back into the legacy slice shape so
// service.go's ShouldNotify gate keeps working without changes.
func enabledMapToChannels(raw []byte) []enums.NotificationChannel {
	if len(raw) == 0 {
		return []enums.NotificationChannel{enums.NotificationChannelTelegram}
	}
	var m map[string]bool
	if err := json.Unmarshal(raw, &m); err != nil {
		return []enums.NotificationChannel{enums.NotificationChannelTelegram}
	}
	out := make([]enums.NotificationChannel, 0, len(m))
	for k, v := range m {
		if !v {
			continue
		}
		ch := enums.NotificationChannel(k)
		if ch.IsValid() {
			out = append(out, ch)
		}
	}
	if len(out) == 0 {
		return []enums.NotificationChannel{enums.NotificationChannelTelegram}
	}
	return out
}

func toPreferences(r notifydb.NotificationPref) domain.Preferences {
	p := domain.Preferences{
		UserID:                    sharedpg.UUIDFrom(r.UserID),
		Channels:                  enabledMapToChannels(r.ChannelEnabled),
		WeeklyReportEnabled:       r.WeeklyReportEnabled,
		SkillDecayWarningsEnabled: r.SkillDecayWarningsEnabled,
		UpdatedAt:                 r.UpdatedAt.Time,
		Quiet:                     domain.QuietHours{Set: false},
	}
	if r.TelegramChatID.Valid {
		p.TelegramChatID = r.TelegramChatID.String
	}
	return p
}
