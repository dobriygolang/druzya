package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/profile/domain"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// GetPercentiles считает 2 перцентиля: in_tier (по elo-bucket'у)
// и in_global. Возвращает 0..100.
//
// Tier-bucket: т.к. колонки tier на ratings нет, используем простые
// elo-bands шириной 200 (1000-1199, 1200-1399, …) — стабильно и
// детерминированно.
//
// in_friends-percentile удалён вместе с friends bounded context (см.
// 00004_remove_friends.sql). Поле осталось в proto для wire-compat,
// фронт его не рендерит — read возвращает 0.
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
	if err := p.pool.QueryRow(ctx, qGlobal, sharedpg.UUID(userID)).Scan(&prGlobal); err != nil && !errors.Is(err, pgx.ErrNoRows) {
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
	if err := p.pool.QueryRow(ctx, qTier, sharedpg.UUID(userID)).Scan(&prTier); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return view, fmt.Errorf("profile.Postgres.GetPercentiles: tier: %w", err)
	}
	view.InTier = clampPct(prTier)

	view.InFriends = 0 // friends bounded context removed; field kept for proto wire-compat.
	return view, nil
}
