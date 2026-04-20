// Package infra holds Postgres, Redis, and HTTP adapters for the notify domain.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/notify/domain"
	notifydb "druz9/notify/infra/db"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.PreferencesRepo, domain.LogRepo, and
// domain.UserLookup on a shared pgxpool.Pool.
type Postgres struct {
	pool *pgxpool.Pool
	q    *notifydb.Queries
}

// NewPostgres constructs the Postgres adapter.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: notifydb.New(pool)}
}

// ── PreferencesRepo ─────────────────────────────────────────────────────────

// Get loads a row. Returns (DefaultPreferences-ish, ErrNotFound) if missing.
func (p *Postgres) Get(ctx context.Context, userID uuid.UUID) (domain.Preferences, error) {
	row, err := p.q.GetPreferences(ctx, pgUUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Preferences{UserID: userID}, domain.ErrNotFound
		}
		return domain.Preferences{}, fmt.Errorf("notify.pg.Get: %w", err)
	}
	return toPreferences(row), nil
}

// Upsert persists a preferences row and returns the authoritative copy.
func (p *Postgres) Upsert(ctx context.Context, pref domain.Preferences) (domain.Preferences, error) {
	params := notifydb.UpsertPreferencesParams{
		UserID:                    pgUUID(pref.UserID),
		Channels:                  channelsToStrings(pref.Channels),
		TelegramChatID:            pgText(pref.TelegramChatID),
		QuietHoursFrom:            pgTimeOfDay(pref.Quiet, true),
		QuietHoursTo:              pgTimeOfDay(pref.Quiet, false),
		WeeklyReportEnabled:       pref.WeeklyReportEnabled,
		SkillDecayWarningsEnabled: pref.SkillDecayWarningsEnabled,
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
		UserID:         pgUUID(userID),
		TelegramChatID: pgText(chatID),
	}); err != nil {
		return fmt.Errorf("notify.pg.SetTelegramChatID: %w", err)
	}
	return nil
}

// ClearTelegramChatID nulls out the chat_id (called by /unlink).
func (p *Postgres) ClearTelegramChatID(ctx context.Context, userID uuid.UUID) error {
	if err := p.q.ClearTelegramChatID(ctx, pgUUID(userID)); err != nil {
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
		out = append(out, fromPgUUID(r))
	}
	return out, nil
}

// ── LogRepo ─────────────────────────────────────────────────────────────────

// Insert writes a pending row to notifications_log.
func (p *Postgres) Insert(ctx context.Context, e domain.LogEntry) (domain.LogEntry, error) {
	payload, err := json.Marshal(e.Payload)
	if err != nil {
		return domain.LogEntry{}, fmt.Errorf("notify.pg.Insert: marshal payload: %w", err)
	}
	row, err := p.q.InsertLog(ctx, notifydb.InsertLogParams{
		UserID:  pgUUID(e.UserID),
		Channel: string(e.Channel),
		Type:    string(e.Type),
		Payload: payload,
		Status:  e.Status,
	})
	if err != nil {
		return domain.LogEntry{}, fmt.Errorf("notify.pg.Insert: %w", err)
	}
	return toLogEntry(row), nil
}

// RecentByType returns rows newer than `since` for dedup.
func (p *Postgres) RecentByType(ctx context.Context, userID uuid.UUID, typ enums.NotificationType, since time.Time) ([]domain.LogEntry, error) {
	rows, err := p.q.RecentLogByType(ctx, notifydb.RecentLogByTypeParams{
		UserID:    pgUUID(userID),
		Type:      string(typ),
		CreatedAt: pgtype.Timestamptz{Time: since, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("notify.pg.RecentByType: %w", err)
	}
	out := make([]domain.LogEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, toLogEntry(r))
	}
	return out, nil
}

// MarkSent flips a row to status=sent.
func (p *Postgres) MarkSent(ctx context.Context, id uuid.UUID, at time.Time) error {
	if err := p.q.MarkLogSent(ctx, notifydb.MarkLogSentParams{
		ID:     pgUUID(id),
		SentAt: pgtype.Timestamptz{Time: at, Valid: true},
	}); err != nil {
		return fmt.Errorf("notify.pg.MarkSent: %w", err)
	}
	return nil
}

// MarkFailed flips a row to status=failed with a short error message.
func (p *Postgres) MarkFailed(ctx context.Context, id uuid.UUID, errMsg string) error {
	if err := p.q.MarkLogFailed(ctx, notifydb.MarkLogFailedParams{
		ID:    pgUUID(id),
		Error: pgText(errMsg),
	}); err != nil {
		return fmt.Errorf("notify.pg.MarkFailed: %w", err)
	}
	return nil
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
	return fromPgUUID(id), nil
}

// GetLocale returns the user's profile locale (defaults to "ru").
func (p *Postgres) GetLocale(ctx context.Context, userID uuid.UUID) (string, error) {
	loc, err := p.q.GetUserLocale(ctx, pgUUID(userID))
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
	_ domain.LogRepo         = (*Postgres)(nil)
	_ domain.UserLookup      = (*Postgres)(nil)
)

// ── helpers ────────────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func pgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: s, Valid: true}
}

// pgTimeOfDay extracts the From/To time from QuietHours into pg's TIME type.
// If the window isn't set, returns Valid=false.
func pgTimeOfDay(q domain.QuietHours, fromSide bool) pgtype.Time {
	if !q.Set {
		return pgtype.Time{Valid: false}
	}
	t := q.From
	if !fromSide {
		t = q.To
	}
	// pgtype.Time is µs since midnight.
	micros := int64(t.Hour())*3600*1_000_000 +
		int64(t.Minute())*60*1_000_000 +
		int64(t.Second())*1_000_000
	return pgtype.Time{Microseconds: micros, Valid: true}
}

func channelsToStrings(cs []enums.NotificationChannel) []string {
	if len(cs) == 0 {
		return []string{string(enums.NotificationChannelTelegram)}
	}
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = string(c)
	}
	return out
}

func stringsToChannels(ss []string) []enums.NotificationChannel {
	out := make([]enums.NotificationChannel, 0, len(ss))
	for _, s := range ss {
		out = append(out, enums.NotificationChannel(s))
	}
	return out
}

func toPreferences(r notifydb.NotificationPreference) domain.Preferences {
	p := domain.Preferences{
		UserID:                    fromPgUUID(r.UserID),
		Channels:                  stringsToChannels(r.Channels),
		WeeklyReportEnabled:       r.WeeklyReportEnabled,
		SkillDecayWarningsEnabled: r.SkillDecayWarningsEnabled,
		UpdatedAt:                 r.UpdatedAt.Time,
	}
	if r.TelegramChatID.Valid {
		p.TelegramChatID = r.TelegramChatID.String
	}
	if r.QuietHoursFrom.Valid && r.QuietHoursTo.Valid {
		p.Quiet = domain.QuietHours{
			From: microsToTime(r.QuietHoursFrom.Microseconds),
			To:   microsToTime(r.QuietHoursTo.Microseconds),
			Set:  true,
		}
	}
	return p
}

func microsToTime(micros int64) time.Time {
	h := int(micros / (3600 * 1_000_000))
	rem := micros % (3600 * 1_000_000)
	m := int(rem / (60 * 1_000_000))
	s := int((rem % (60 * 1_000_000)) / 1_000_000)
	return time.Date(2000, 1, 1, h, m, s, 0, time.UTC)
}

func toLogEntry(r notifydb.NotificationsLog) domain.LogEntry {
	out := domain.LogEntry{
		ID:        fromPgUUID(r.ID),
		UserID:    fromPgUUID(r.UserID),
		Channel:   enums.NotificationChannel(r.Channel),
		Type:      enums.NotificationType(r.Type),
		Status:    r.Status,
		CreatedAt: r.CreatedAt.Time,
	}
	if len(r.Payload) > 0 {
		var m map[string]any
		if err := json.Unmarshal(r.Payload, &m); err == nil {
			out.Payload = m
		}
	}
	if r.SentAt.Valid {
		t := r.SentAt.Time
		out.SentAt = &t
	}
	if r.Error.Valid {
		out.Error = r.Error.String
	}
	return out
}
