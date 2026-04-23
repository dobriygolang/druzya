// Package infra provides the PostgreSQL-backed ProfileRepo.
// Most queries are now served by the sqlc-generated profiledb.Queries; a few
// pieces that require dynamic SQL (settings + daily_streaks upsert) remain
// hand-rolled and are marked accordingly.
package infra

import (
	"context"
	"crypto/rand"
	"encoding/hex"
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
		       COALESCE(np.skill_decay_warnings_enabled, true),
		       COALESCE(u.ai_insight_model, ''),
		       (u.onboarding_completed_at IS NOT NULL) AS onboarding_completed,
		       COALESCE(u.focus_class, '')
		  FROM users u
		  LEFT JOIN notification_preferences np ON np.user_id = u.id
		 WHERE u.id = $1`, userID)
	var s domain.Settings
	var channels []string
	if err := row.Scan(
		&s.DisplayName, &s.Locale,
		&channels, &s.Notifications.TelegramChatID,
		&s.Notifications.WeeklyReportEnabled, &s.Notifications.SkillDecayWarningsEnabled,
		&s.AIInsightModel,
		&s.OnboardingCompleted,
		&s.FocusClass,
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

	// users base columns. The two onboarding-state columns (focus_class +
	// onboarding_completed_at) use a HasX gate from the inbound proto so
	// PUT-with-only-display_name does not clobber a previously chosen
	// focus class. CASE WHEN keeps the column at its current value when
	// the caller did not include it.
	if _, err := tx.Exec(ctx,
		`UPDATE users
		    SET display_name = NULLIF($2,''),
		        locale = COALESCE(NULLIF($3,''), locale),
		        ai_insight_model = NULLIF($4,''),
		        focus_class = CASE WHEN $5::bool THEN $6 ELSE focus_class END,
		        onboarding_completed_at = CASE
		            WHEN $7::bool AND $8::bool THEN now()
		            WHEN $7::bool AND NOT $8::bool THEN NULL
		            ELSE onboarding_completed_at
		        END,
		        updated_at = now()
		  WHERE id = $1`,
		userID, s.DisplayName, s.Locale, s.AIInsightModel,
		s.HasFocusClass, s.FocusClass,
		s.HasOnboardingCompleted, s.OnboardingCompleted,
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

// UpsertSkillNode upserts (user_id, node_key) into skill_nodes with the
// given progress. Validates the node exists in atlas_nodes (returns
// ErrNotFound if not). On conflict, progress = GREATEST(stored, incoming)
// — re-allocating the same skill never regresses an in-progress node.
func (p *Postgres) UpsertSkillNode(ctx context.Context, userID uuid.UUID, nodeKey string, progress int) (domain.SkillNode, error) {
	if nodeKey == "" {
		return domain.SkillNode{}, fmt.Errorf("profile.Postgres.UpsertSkillNode: node_key is required")
	}
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}
	// Existence check against atlas_nodes — anti-fallback: do not silently
	// create orphan skill_nodes rows that point at a missing catalogue id.
	var exists bool
	if err := p.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM atlas_nodes WHERE id = $1 AND is_active = TRUE)`,
		nodeKey,
	).Scan(&exists); err != nil {
		return domain.SkillNode{}, fmt.Errorf("profile.Postgres.UpsertSkillNode: check node: %w", err)
	}
	if !exists {
		return domain.SkillNode{}, fmt.Errorf("profile.Postgres.UpsertSkillNode: %w", domain.ErrNotFound)
	}
	const q = `
		INSERT INTO skill_nodes (user_id, node_key, progress, unlocked_at, updated_at)
		VALUES ($1, $2, $3, now(), now())
		ON CONFLICT (user_id, node_key) DO UPDATE SET
		    progress    = GREATEST(skill_nodes.progress, EXCLUDED.progress),
		    unlocked_at = COALESCE(skill_nodes.unlocked_at, EXCLUDED.unlocked_at),
		    updated_at  = now()
		RETURNING progress, unlocked_at, decayed_at, updated_at`
	var sn domain.SkillNode
	sn.NodeKey = nodeKey
	var unlocked, decayed pgtype.Timestamptz
	var updated pgtype.Timestamptz
	if err := p.pool.QueryRow(ctx, q, pgUUID(userID), nodeKey, int32(progress)).Scan(
		&sn.Progress, &unlocked, &decayed, &updated,
	); err != nil {
		return domain.SkillNode{}, fmt.Errorf("profile.Postgres.UpsertSkillNode: %w", err)
	}
	if unlocked.Valid {
		t := unlocked.Time
		sn.UnlockedAt = &t
	}
	if decayed.Valid {
		t := decayed.Time
		sn.DecayedAt = &t
	}
	if updated.Valid {
		sn.UpdatedAt = updated.Time
	}
	return sn, nil
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

// ── Phase A killer-stats ───────────────────────────────────────────────────

// ListHourlyActivitySince — флэт-массив 168 (dow*24+hour) с числом матчей,
// в которых пользователь участвовал. Пустые ячейки = 0. Хэнд-роллед pgx,
// потому что dow/hour-арифметика на стороне SQL не вписывается в sqlc.
func (p *Postgres) ListHourlyActivitySince(ctx context.Context, userID uuid.UUID, since time.Time) ([168]int, error) {
	var out [168]int
	const q = `
		SELECT EXTRACT(DOW FROM m.started_at)::int  AS dow,
		       EXTRACT(HOUR FROM m.started_at)::int AS hour,
		       COUNT(*)::int                          AS cnt
		  FROM arena_matches m
		  JOIN arena_participants ap ON ap.match_id = m.id AND ap.user_id = $1
		 WHERE m.started_at IS NOT NULL
		   AND m.started_at >= $2
		 GROUP BY dow, hour`
	rows, err := p.pool.Query(ctx, q, pgUUID(userID), since)
	if err != nil {
		return out, fmt.Errorf("profile.Postgres.ListHourlyActivitySince: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var dow, hour, cnt int
		if err := rows.Scan(&dow, &hour, &cnt); err != nil {
			return out, fmt.Errorf("profile.Postgres.ListHourlyActivitySince: scan: %w", err)
		}
		if dow < 0 || dow > 6 || hour < 0 || hour > 23 {
			continue
		}
		out[dow*24+hour] = cnt
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("profile.Postgres.ListHourlyActivitySince: rows: %w", err)
	}
	return out, nil
}

// ListEloSnapshotsSince читает elo_snapshots_daily в окне [since, now]
// и сортирует по дате ASC.
func (p *Postgres) ListEloSnapshotsSince(ctx context.Context, userID uuid.UUID, since time.Time) ([]domain.EloPoint, error) {
	const q = `
		SELECT snapshot_date, section, elo
		  FROM elo_snapshots_daily
		 WHERE user_id = $1 AND snapshot_date >= $2::date
		 ORDER BY snapshot_date ASC, section ASC`
	rows, err := p.pool.Query(ctx, q, pgUUID(userID), since)
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListEloSnapshotsSince: %w", err)
	}
	defer rows.Close()
	out := make([]domain.EloPoint, 0, 32)
	for rows.Next() {
		var date time.Time
		var section string
		var elo int
		if err := rows.Scan(&date, &section, &elo); err != nil {
			return nil, fmt.Errorf("profile.Postgres.ListEloSnapshotsSince: scan: %w", err)
		}
		out = append(out, domain.EloPoint{
			Date:    date,
			Section: enums.Section(section),
			Elo:     elo,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListEloSnapshotsSince: rows: %w", err)
	}
	return out, nil
}

// GetPercentiles считает 3 перцентиля: in_tier (по elo-bucket'у),
// in_friends (среди принятых дружб), in_global. Возвращает 0..100.
//
// Tier-bucket: т.к. колонки tier на ratings нет, используем простые
// elo-bands шириной 200 (1000-1199, 1200-1399, …) — стабильно и
// детерминированно. Возвращает только секцию с максимальным elo
// пользователя (для weekly-блока этого достаточно).
func (p *Postgres) GetPercentiles(ctx context.Context, userID uuid.UUID, _ time.Time) (domain.PercentileView, error) {
	var view domain.PercentileView
	// 1. Глобальный перцентиль по сумме elo всех секций.
	const qGlobal = `
		WITH totals AS (
		    SELECT user_id, SUM(elo)::int AS total_elo
		      FROM ratings
		     GROUP BY user_id
		),
		ranked AS (
		    SELECT user_id, total_elo,
		           PERCENT_RANK() OVER (ORDER BY total_elo)::float8 AS pr
		      FROM totals
		)
		SELECT pr FROM ranked WHERE user_id = $1`
	var prGlobal float64
	if err := p.pool.QueryRow(ctx, qGlobal, pgUUID(userID)).Scan(&prGlobal); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return view, fmt.Errorf("profile.Postgres.GetPercentiles: global: %w", err)
	}
	view.InGlobal = clampPct(prGlobal)

	// 2. In-tier: bucket = floor(total_elo / 200).
	const qTier = `
		WITH totals AS (
		    SELECT user_id, SUM(elo)::int AS total_elo
		      FROM ratings
		     GROUP BY user_id
		),
		bucketed AS (
		    SELECT user_id, total_elo, (total_elo / 200) AS bucket
		      FROM totals
		),
		me AS (SELECT bucket FROM bucketed WHERE user_id = $1),
		ranked AS (
		    SELECT b.user_id,
		           PERCENT_RANK() OVER (ORDER BY b.total_elo)::float8 AS pr
		      FROM bucketed b
		      JOIN me ON me.bucket = b.bucket
		)
		SELECT pr FROM ranked WHERE user_id = $1`
	var prTier float64
	if err := p.pool.QueryRow(ctx, qTier, pgUUID(userID)).Scan(&prTier); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return view, fmt.Errorf("profile.Postgres.GetPercentiles: tier: %w", err)
	}
	view.InTier = clampPct(prTier)

	// 3. In-friends: ранк среди accepted-друзей (двунаправленно).
	const qFriends = `
		WITH friend_ids AS (
		    SELECT addressee_id AS uid FROM friendships
		     WHERE requester_id = $1 AND status = 'accepted'
		    UNION
		    SELECT requester_id AS uid FROM friendships
		     WHERE addressee_id = $1 AND status = 'accepted'
		    UNION SELECT $1
		),
		totals AS (
		    SELECT r.user_id, SUM(r.elo)::int AS total_elo
		      FROM ratings r
		      JOIN friend_ids f ON f.uid = r.user_id
		     GROUP BY r.user_id
		),
		ranked AS (
		    SELECT user_id,
		           PERCENT_RANK() OVER (ORDER BY total_elo)::float8 AS pr
		      FROM totals
		)
		SELECT pr FROM ranked WHERE user_id = $1`
	var prFriends float64
	if err := p.pool.QueryRow(ctx, qFriends, pgUUID(userID)).Scan(&prFriends); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return view, fmt.Errorf("profile.Postgres.GetPercentiles: friends: %w", err)
	}
	view.InFriends = clampPct(prFriends)
	return view, nil
}

// IssueShareToken — INSERT в weekly_share_tokens с TTL 30d. Token —
// 32-байтовый hex (64 chars).
func (p *Postgres) IssueShareToken(ctx context.Context, userID uuid.UUID, weekISO string) (domain.ShareToken, error) {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return domain.ShareToken{}, fmt.Errorf("profile.Postgres.IssueShareToken: rand: %w", err)
	}
	tok := hex.EncodeToString(buf[:])
	expires := time.Now().UTC().Add(30 * 24 * time.Hour)
	const q = `
		INSERT INTO weekly_share_tokens(user_id, week_iso, token, expires_at)
		VALUES ($1, $2, $3, $4)`
	if _, err := p.pool.Exec(ctx, q, pgUUID(userID), weekISO, tok, expires); err != nil {
		return domain.ShareToken{}, fmt.Errorf("profile.Postgres.IssueShareToken: insert: %w", err)
	}
	return domain.ShareToken{
		Token:     tok,
		WeekISO:   weekISO,
		ExpiresAt: expires,
	}, nil
}

// ResolveShareToken — атомарно SELECT + UPDATE views_count. Возвращает
// ErrNotFound если токен протух или не существует.
func (p *Postgres) ResolveShareToken(ctx context.Context, token string) (domain.ShareResolution, error) {
	const q = `
		UPDATE weekly_share_tokens
		   SET views_count = views_count + 1
		 WHERE token = $1 AND expires_at > now()
		 RETURNING user_id, week_iso`
	var uid pgtype.UUID
	var weekISO string
	if err := p.pool.QueryRow(ctx, q, token).Scan(&uid, &weekISO); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ShareResolution{}, fmt.Errorf("profile.Postgres.ResolveShareToken: %w", domain.ErrNotFound)
		}
		return domain.ShareResolution{}, fmt.Errorf("profile.Postgres.ResolveShareToken: %w", err)
	}
	return domain.ShareResolution{
		UserID:  fromPgUUID(uid),
		WeekISO: weekISO,
	}, nil
}

// ListAchievementsSince — все ачивки с unlocked_at >= since.
// Title/tier на этом этапе берём из catalogue в коде (см. achievements
// домен); здесь возвращаем только сырые значения из user_achievements,
// title=code, tier="" — другие фазы дотянут метаданные.
func (p *Postgres) ListAchievementsSince(ctx context.Context, userID uuid.UUID, since time.Time) ([]domain.AchievementBrief, error) {
	const q = `
		SELECT code, COALESCE(unlocked_at, now())
		  FROM user_achievements
		 WHERE user_id = $1
		   AND unlocked_at IS NOT NULL
		   AND unlocked_at >= $2
		 ORDER BY unlocked_at DESC`
	rows, err := p.pool.Query(ctx, q, pgUUID(userID), since)
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListAchievementsSince: %w", err)
	}
	defer rows.Close()
	out := make([]domain.AchievementBrief, 0, 8)
	for rows.Next() {
		var code string
		var unlocked time.Time
		if err := rows.Scan(&code, &unlocked); err != nil {
			return nil, fmt.Errorf("profile.Postgres.ListAchievementsSince: scan: %w", err)
		}
		out = append(out, domain.AchievementBrief{
			Code:       code,
			Title:      code,
			UnlockedAt: unlocked,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListAchievementsSince: rows: %w", err)
	}
	return out, nil
}

func clampPct(p float64) int {
	v := int(p*100 + 0.5)
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
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
