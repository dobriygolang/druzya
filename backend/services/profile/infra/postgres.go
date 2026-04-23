// Package infra provides the PostgreSQL-backed ProfileRepo.
// Most queries are now served by the sqlc-generated profiledb.Queries; a few
// pieces that require dynamic SQL (settings + daily_streaks upsert) remain
// hand-rolled and are marked accordingly.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/profile/domain"
	profiledb "druz9/profile/infra/db"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.ProfileRepo.
type Postgres struct {
	pool *pgxpool.Pool
	q    *profiledb.Queries
}

// NewPostgres wraps a pool and prepares a Queries handle.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: profiledb.New(pool)}
}

// GetByUserID joins users + profiles + subscriptions + ai_credits via sqlc,
// then pulls ratings separately.
func (p *Postgres) GetByUserID(ctx context.Context, userID uuid.UUID) (domain.Bundle, error) {
	row, err := p.q.GetProfileBundle(ctx, pgUUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Bundle{}, fmt.Errorf("profile.Postgres.GetByUserID: %w", domain.ErrNotFound)
		}
		return domain.Bundle{}, fmt.Errorf("profile.Postgres.GetByUserID: %w", err)
	}
	b := domain.Bundle{}
	b.User = domain.User{
		ID:          fromPgUUID(row.ID),
		Email:       pgText(row.Email),
		Username:    row.Username,
		Role:        enums.UserRole(row.Role),
		Locale:      row.Locale,
		DisplayName: pgText(row.DisplayName),
		CreatedAt:   row.CreatedAt.Time,
	}
	b.Profile = domain.Profile{
		UserID:      userID,
		CharClass:   enums.CharClass(row.CharClass),
		Level:       int(row.Level),
		XP:          row.Xp,
		Title:       pgText(row.Title),
		AvatarFrame: pgText(row.AvatarFrame),
		CareerStage: domain.CareerStage(row.CareerStage),
		Attributes: domain.Attributes{
			Intellect: int(row.Intellect),
			Strength:  int(row.Strength),
			Dexterity: int(row.Dexterity),
			Will:      int(row.Will),
		},
		UpdatedAt: row.UpdatedAt.Time,
	}
	if row.Plan.Valid {
		b.Subscription = domain.Subscription{
			UserID: userID,
			Plan:   enums.SubscriptionPlan(row.Plan.String),
			Status: pgText(row.Status),
		}
		if row.CurrentPeriodEnd.Valid {
			t := row.CurrentPeriodEnd.Time
			b.Subscription.CurrentPeriodEnd = &t
		}
	} else {
		b.Subscription.Plan = enums.SubscriptionPlanFree
		b.Subscription.Status = "active"
	}
	if row.Balance.Valid {
		b.AICredits = int(row.Balance.Int32)
	}
	ratings, err := p.ListRatings(ctx, userID)
	if err != nil {
		return domain.Bundle{}, fmt.Errorf("profile.Postgres.GetByUserID: ratings: %w", err)
	}
	b.Ratings = ratings
	return b, nil
}

// GetPublic returns the SEO-visible subset for /u/{username}.
func (p *Postgres) GetPublic(ctx context.Context, username string) (domain.PublicBundle, error) {
	row, err := p.q.GetProfilePublic(ctx, username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.PublicBundle{}, fmt.Errorf("profile.Postgres.GetPublic: %w", domain.ErrNotFound)
		}
		return domain.PublicBundle{}, fmt.Errorf("profile.Postgres.GetPublic: %w", err)
	}
	b := domain.PublicBundle{}
	b.User = domain.User{
		ID:          fromPgUUID(row.ID),
		Username:    row.Username,
		DisplayName: pgText(row.DisplayName),
		CreatedAt:   row.CreatedAt.Time,
	}
	b.Profile = domain.Profile{
		UserID:      b.User.ID,
		CharClass:   enums.CharClass(row.CharClass),
		Level:       int(row.Level),
		XP:          row.Xp,
		Title:       pgText(row.Title),
		AvatarFrame: pgText(row.AvatarFrame),
		CareerStage: domain.CareerStage(row.CareerStage),
	}
	if ratings, err := p.ListRatings(ctx, b.User.ID); err != nil {
		return domain.PublicBundle{}, fmt.Errorf("profile.Postgres.GetPublic: ratings: %w", err)
	} else {
		b.Ratings = ratings
	}
	if nodes, err := p.ListSkillNodes(ctx, b.User.ID); err != nil {
		return domain.PublicBundle{}, fmt.Errorf("profile.Postgres.GetPublic: nodes: %w", err)
	} else {
		b.Atlas = nodes
	}
	return b, nil
}

// EnsureDefaults seeds profile/subscription/ai_credits/prefs and daily_streaks.
// daily_streaks lives in a different domain (daily) but the MVP creates it here
// so new users don't 404 on first GET /daily/streak.
func (p *Postgres) EnsureDefaults(ctx context.Context, userID uuid.UUID) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := p.q.WithTx(tx)
	uid := pgUUID(userID)

	if err := qtx.EnsureProfile(ctx, uid); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: profile: %w", err)
	}
	if err := qtx.EnsureSubscription(ctx, uid); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: subscription: %w", err)
	}
	if err := qtx.EnsureAICredits(ctx, uid); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: ai_credits: %w", err)
	}
	if err := qtx.EnsureNotificationPrefs(ctx, uid); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: prefs: %w", err)
	}
	// NOTE: daily_streaks ensure — cross-domain init, not in profile sqlc.
	if _, err := tx.Exec(ctx,
		`INSERT INTO daily_streaks(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: streak: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: commit: %w", err)
	}
	return nil
}

// ApplyXPDelta updates level+xp via sqlc.
func (p *Postgres) ApplyXPDelta(ctx context.Context, userID uuid.UUID, addXP int, newLevel int, remainderXP int64) error {
	if err := p.q.UpdateProfileXPLevel(ctx, profiledb.UpdateProfileXPLevelParams{
		UserID: pgUUID(userID),
		Level:  int32(newLevel),
		Xp:     remainderXP,
	}); err != nil {
		return fmt.Errorf("profile.Postgres.ApplyXPDelta: %w", err)
	}
	_ = addXP // carried through via the XP event for audit
	return nil
}

// UpdateCareerStage writes back the derived seniority.
func (p *Postgres) UpdateCareerStage(ctx context.Context, userID uuid.UUID, stage domain.CareerStage) error {
	if !stage.IsValid() {
		return fmt.Errorf("profile.Postgres.UpdateCareerStage: invalid stage %q", stage)
	}
	if err := p.q.UpdateCareerStage(ctx, profiledb.UpdateCareerStageParams{
		UserID:      pgUUID(userID),
		CareerStage: stage.String(),
	}); err != nil {
		return fmt.Errorf("profile.Postgres.UpdateCareerStage: %w", err)
	}
	return nil
}

// GetSettings composes users + notification_preferences.
// NOTE: dynamic COALESCE + cross-table join with defaults, sqlc can't generate — keep hand-rolled.
func (p *Postgres) GetSettings(ctx context.Context, userID uuid.UUID) (domain.Settings, error) {
	row := p.pool.QueryRow(ctx, `
		SELECT COALESCE(u.display_name,''), u.locale,
		       COALESCE(np.channels, ARRAY['telegram']::text[]),
		       COALESCE(np.telegram_chat_id,''),
		       COALESCE(np.weekly_report_enabled, true),
		       COALESCE(np.skill_decay_warnings_enabled, true)
		  FROM users u
		  LEFT JOIN notification_preferences np ON np.user_id = u.id
		 WHERE u.id = $1`, userID)
	var s domain.Settings
	var channels []string
	if err := row.Scan(
		&s.DisplayName, &s.Locale,
		&channels, &s.Notifications.TelegramChatID,
		&s.Notifications.WeeklyReportEnabled, &s.Notifications.SkillDecayWarningsEnabled,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Settings{}, fmt.Errorf("profile.Postgres.GetSettings: %w", domain.ErrNotFound)
		}
		return domain.Settings{}, fmt.Errorf("profile.Postgres.GetSettings: %w", err)
	}
	s.DefaultLanguage = enums.LanguageGo
	s.Notifications.Channels = parseChannels(channels)
	return s, nil
}

// UpdateSettings upserts users.* and notification_preferences in one tx.
// NOTE: two separate tables + conditional NULLIF updates; sqlc could express
// each half but composing them in a tx is still wire-by-hand. Keep hand-rolled.
func (p *Postgres) UpdateSettings(ctx context.Context, userID uuid.UUID, s domain.Settings) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("profile.Postgres.UpdateSettings: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`UPDATE users SET display_name=NULLIF($2,''), locale=COALESCE(NULLIF($3,''), locale), updated_at=now() WHERE id=$1`,
		userID, s.DisplayName, s.Locale,
	); err != nil {
		return fmt.Errorf("profile.Postgres.UpdateSettings: users: %w", err)
	}
	chStrs := make([]string, 0, len(s.Notifications.Channels))
	for _, c := range s.Notifications.Channels {
		if c.IsValid() {
			chStrs = append(chStrs, c.String())
		}
	}
	if len(chStrs) == 0 {
		chStrs = []string{enums.NotificationChannelTelegram.String()}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO notification_preferences(user_id, channels, telegram_chat_id, weekly_report_enabled, skill_decay_warnings_enabled)
		VALUES ($1, $2, NULLIF($3,''), $4, $5)
		ON CONFLICT (user_id) DO UPDATE SET
		    channels = EXCLUDED.channels,
		    telegram_chat_id = EXCLUDED.telegram_chat_id,
		    weekly_report_enabled = EXCLUDED.weekly_report_enabled,
		    skill_decay_warnings_enabled = EXCLUDED.skill_decay_warnings_enabled,
		    updated_at = now()
	`, userID, chStrs, s.Notifications.TelegramChatID, s.Notifications.WeeklyReportEnabled, s.Notifications.SkillDecayWarningsEnabled); err != nil {
		return fmt.Errorf("profile.Postgres.UpdateSettings: prefs: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("profile.Postgres.UpdateSettings: commit: %w", err)
	}
	return nil
}

// ListSkillNodes via sqlc.
func (p *Postgres) ListSkillNodes(ctx context.Context, userID uuid.UUID) ([]domain.SkillNode, error) {
	rows, err := p.q.ListSkillNodes(ctx, pgUUID(userID))
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListSkillNodes: %w", err)
	}
	out := make([]domain.SkillNode, 0, len(rows))
	for _, r := range rows {
		n := domain.SkillNode{
			NodeKey:   r.NodeKey,
			Progress:  int(r.Progress),
			UpdatedAt: r.UpdatedAt.Time,
		}
		if r.UnlockedAt.Valid {
			t := r.UnlockedAt.Time
			n.UnlockedAt = &t
		}
		if r.DecayedAt.Valid {
			t := r.DecayedAt.Time
			n.DecayedAt = &t
		}
		out = append(out, n)
	}
	return out, nil
}

// ListRatings via sqlc.
func (p *Postgres) ListRatings(ctx context.Context, userID uuid.UUID) ([]domain.SectionRating, error) {
	rows, err := p.q.ListRatings(ctx, pgUUID(userID))
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListRatings: %w", err)
	}
	out := make([]domain.SectionRating, 0, len(rows))
	for _, r := range rows {
		sr := domain.SectionRating{
			Section:      enums.Section(r.Section),
			Elo:          int(r.Elo),
			MatchesCount: int(r.MatchesCount),
		}
		if r.LastMatchAt.Valid {
			t := r.LastMatchAt.Time
			sr.LastMatchAt = &t
		}
		out = append(out, sr)
	}
	return out, nil
}

// CountRecentActivity via sqlc-generated weekly counts.
func (p *Postgres) CountRecentActivity(ctx context.Context, userID uuid.UUID, since time.Time) (domain.Activity, error) {
	row, err := p.q.CountWeeklyActivity(ctx, profiledb.CountWeeklyActivityParams{
		UserID:      pgUUID(userID),
		SubmittedAt: pgtype.Timestamptz{Time: since, Valid: true},
	})
	if err != nil {
		return domain.Activity{}, fmt.Errorf("profile.Postgres.CountRecentActivity: %w", err)
	}
	return domain.Activity{
		TasksSolved: int(row.KatasPassed),
		MatchesWon:  int(row.MatchesWon),
		TimeMinutes: int(row.MockMinutes),
		// STUB: rating_change + xp_earned require event-sourced history we don't yet persist.
	}, nil
}

// ListMatchAggregatesSince возвращает плоский список матчей пользователя
// (только finished) за период. Для MVP читаем напрямую из arena_matches +
// arena_participants. XPDelta берётся как (elo_after - elo_before) — это
// прокси-LP, который коррелирует с XP-наградой за матч.
//
// Если арена-таблиц нет / запрос провалился, возвращаем пустой срез без
// ошибки — отчёт деградирует к «нет данных», базовые метрики продолжают
// работать.
func (p *Postgres) ListMatchAggregatesSince(ctx context.Context, userID uuid.UUID, since time.Time) ([]domain.MatchAggregate, error) {
	const q = `
		SELECT m.section, m.winner_id = $1 AS won,
		       COALESCE(ap.elo_after, ap.elo_before) - ap.elo_before AS xp_delta
		  FROM arena_matches m
		  JOIN arena_participants ap ON ap.match_id = m.id AND ap.user_id = $1
		 WHERE m.status = 'finished'
		   AND m.finished_at >= $2`
	rows, err := p.pool.Query(ctx, q, pgUUID(userID), since)
	if err != nil {
		// Не роняем отчёт — арена-данных может не быть в среде разработки.
		return nil, nil
	}
	defer rows.Close()
	out := make([]domain.MatchAggregate, 0, 16)
	for rows.Next() {
		var section string
		var won bool
		var xpDelta int
		if err := rows.Scan(&section, &won, &xpDelta); err != nil {
			continue
		}
		out = append(out, domain.MatchAggregate{
			Section: enums.Section(section),
			Win:     won,
			XPDelta: xpDelta,
		})
	}
	return out, nil
}

// ListWeeklyXPSince возвращает XP за каждую из последних `weeks` календарных
// недель. Индекс 0 = текущая неделя. Если таблиц для XP-history нет, тихо
// возвращаем нули — фронт нарисует «пусто».
func (p *Postgres) ListWeeklyXPSince(ctx context.Context, userID uuid.UUID, now time.Time, weeks int) ([]int, error) {
	if weeks <= 0 {
		return nil, nil
	}
	out := make([]int, weeks)
	end := now.UTC().Truncate(24 * time.Hour)
	for i := 0; i < weeks; i++ {
		start := end.Add(-time.Duration(i+1) * 7 * 24 * time.Hour)
		stop := end.Add(-time.Duration(i) * 7 * 24 * time.Hour)
		const q = `
			SELECT COALESCE(SUM(GREATEST(COALESCE(ap.elo_after, ap.elo_before) - ap.elo_before, 0)),0)::int
			  FROM arena_matches m
			  JOIN arena_participants ap ON ap.match_id = m.id AND ap.user_id = $1
			 WHERE m.status = 'finished'
			   AND m.finished_at >= $2
			   AND m.finished_at < $3`
		var xp int
		_ = p.pool.QueryRow(ctx, q, pgUUID(userID), start, stop).Scan(&xp)
		out[i] = xp
	}
	return out, nil
}

// GetStreaks читает текущий и лучший streak из daily_streaks. Если таблицы
// нет, возвращаем (0, 0) без ошибки.
func (p *Postgres) GetStreaks(ctx context.Context, userID uuid.UUID) (int, int, error) {
	const q = `SELECT current_streak, best_streak FROM daily_streaks WHERE user_id = $1`
	var cur, best int
	if err := p.pool.QueryRow(ctx, q, pgUUID(userID)).Scan(&cur, &best); err != nil {
		// Включая pgx.ErrNoRows — у новых пользователей просто нет строки.
		return 0, 0, nil
	}
	return cur, best, nil
}

// ── helpers ────────────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func pgText(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

func parseChannels(raw []string) []enums.NotificationChannel {
	out := make([]enums.NotificationChannel, 0, len(raw))
	for _, r := range raw {
		ch := enums.NotificationChannel(r)
		if ch.IsValid() {
			out = append(out, ch)
		}
	}
	return out
}
