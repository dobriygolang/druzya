package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/profile/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

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
