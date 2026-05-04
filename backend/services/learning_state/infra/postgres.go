// Package infra — Postgres-имплементация learning_state.domain.Repo.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/learning_state/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepo struct {
	pool *pgxpool.Pool
}

func NewPostgresRepo(pool *pgxpool.Pool) *PostgresRepo {
	return &PostgresRepo{pool: pool}
}

const selectColumns = `user_id, mode, fork_branch, explore_started_at,
		committed_track_id, committed_at, created_at, updated_at`

func (r *PostgresRepo) Get(ctx context.Context, userID uuid.UUID) (domain.State, error) {
	var (
		s    domain.State
		mode string
		fork *string
	)
	err := r.pool.QueryRow(ctx,
		`SELECT `+selectColumns+`
		   FROM learning_state WHERE user_id = $1`,
		userID,
	).Scan(
		&s.UserID, &mode, &fork, &s.ExploreStartedAt,
		&s.CommittedTrackID, &s.CommittedAt, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.State{}, domain.ErrNotFound
		}
		return domain.State{}, fmt.Errorf("learning_state.PostgresRepo.Get: %w", err)
	}
	s.Mode = domain.Mode(mode)
	if fork != nil {
		fb := domain.ForkBranch(*fork)
		s.ForkBranch = &fb
	}
	return s, nil
}

// Upsert вставляет либо обновляет строку. UpdatedAt всегда now() на
// DB-уровне (триггера нет — выставляем явно). created_at — только при
// INSERT, на UPDATE не трогаем (DO UPDATE SET без created_at).
func (r *PostgresRepo) Upsert(ctx context.Context, s domain.State) error {
	var fork *string
	if s.ForkBranch != nil {
		v := string(*s.ForkBranch)
		fork = &v
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO learning_state
			(user_id, mode, fork_branch, explore_started_at,
			 committed_track_id, committed_at, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, now(), now())
		 ON CONFLICT (user_id) DO UPDATE SET
			mode               = EXCLUDED.mode,
			fork_branch        = EXCLUDED.fork_branch,
			explore_started_at = EXCLUDED.explore_started_at,
			committed_track_id = EXCLUDED.committed_track_id,
			committed_at       = EXCLUDED.committed_at,
			updated_at         = now()`,
		s.UserID, string(s.Mode), fork, s.ExploreStartedAt,
		s.CommittedTrackID, s.CommittedAt,
	)
	if err != nil {
		return fmt.Errorf("learning_state.PostgresRepo.Upsert: %w", err)
	}
	return nil
}
