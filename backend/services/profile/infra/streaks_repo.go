package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/profile/domain"
	profiledb "druz9/profile/infra/db"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// CountRecentActivity via sqlc-generated weekly counts.
func (p *Postgres) CountRecentActivity(ctx context.Context, userID uuid.UUID, since time.Time) (domain.Activity, error) {
	row, err := p.q.CountWeeklyActivity(ctx, profiledb.CountWeeklyActivityParams{
		UserID:      sharedpg.UUID(userID),
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

// GetStreaks читает текущий и лучший streak из daily_streaks. Отсутствие
// строки (pgx.ErrNoRows) — нормальный кейс для новых пользователей и
// возвращает (0, 0, nil). Остальные ошибки пробрасываются наверх (use case
// логирует и деградирует).
func (p *Postgres) GetStreaks(ctx context.Context, userID uuid.UUID) (int, int, error) {
	const q = `SELECT current_streak, best_streak FROM daily_streaks WHERE user_id = $1`
	var cur, best int
	if err := p.pool.QueryRow(ctx, q, sharedpg.UUID(userID)).Scan(&cur, &best); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, 0, nil
		}
		return 0, 0, fmt.Errorf("profile.Postgres.GetStreaks: %w", err)
	}
	return cur, best, nil
}
