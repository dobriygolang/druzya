package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/profile/domain"
	profiledb "druz9/profile/infra/db"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
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
