// milestones_postgres.go — pgx adapter over user_milestones (migration 00094).
//
// Replace atomically deletes prior generation + inserts new set в одной tx.
// LatestSet возвращает все milestones одной generation; MarkDone scoped by
// (id, user_id) чтобы избежать cross-user writes.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MilestonesPostgres — pgx-backed MilestoneRepo.
type MilestonesPostgres struct{ pool *pgxpool.Pool }

// NewMilestonesPostgres wires the adapter.
func NewMilestonesPostgres(pool *pgxpool.Pool) *MilestonesPostgres {
	return &MilestonesPostgres{pool: pool}
}

// LatestSet returns all milestones for (user, goal) ordered by week_index ASC.
func (r *MilestonesPostgres) LatestSet(ctx context.Context, userID, goalID uuid.UUID) ([]domain.Milestone, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, week_index, week_start, title, detail, category,
		       done_at, generated_at, updated_at
		  FROM user_milestones
		 WHERE user_id = $1 AND goal_id = $2
		 ORDER BY week_index ASC`,
		sharedpg.UUID(userID), sharedpg.UUID(goalID),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.MilestonesPostgres.LatestSet: %w", err)
	}
	defer rows.Close()
	return scanMilestones(rows, userID, goalID)
}

// Replace deletes prior generation + inserts new items atomically.
//
// Empty items slice — допустимо (no-op tx + DELETE; returns empty slice).
func (r *MilestonesPostgres) Replace(ctx context.Context, userID, goalID uuid.UUID, items []domain.Milestone) ([]domain.Milestone, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("intelligence.MilestonesPostgres.Replace begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`DELETE FROM user_milestones WHERE user_id = $1 AND goal_id = $2`,
		sharedpg.UUID(userID), sharedpg.UUID(goalID),
	); err != nil {
		return nil, fmt.Errorf("intelligence.MilestonesPostgres.Replace delete: %w", err)
	}

	if len(items) == 0 {
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("intelligence.MilestonesPostgres.Replace commit: %w", err)
		}
		return nil, nil
	}

	saved := make([]domain.Milestone, 0, len(items))
	for _, m := range items {
		var (
			id                          pgtype.UUID
			generatedAt, updatedAt      time.Time
		)
		category := string(m.Category)
		if category == "" {
			category = string(domain.MilestoneCategoryPractice)
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO user_milestones
			    (user_id, goal_id, week_index, week_start, title, detail, category)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id, generated_at, updated_at`,
			sharedpg.UUID(userID),
			sharedpg.UUID(goalID),
			m.WeekIndex,
			m.WeekStart.UTC(),
			m.Title,
			m.Detail,
			category,
		).Scan(&id, &generatedAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("intelligence.MilestonesPostgres.Replace insert week %d: %w", m.WeekIndex, err)
		}
		out := m
		out.ID = sharedpg.UUIDFrom(id)
		out.UserID = userID
		out.GoalID = goalID
		out.Category = domain.MilestoneCategory(category)
		out.GeneratedAt = generatedAt
		out.UpdatedAt = updatedAt
		saved = append(saved, out)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("intelligence.MilestonesPostgres.Replace commit: %w", err)
	}
	return saved, nil
}

// MarkDone flips done_at. done=false — clears NULL.
func (r *MilestonesPostgres) MarkDone(ctx context.Context, userID, milestoneID uuid.UUID, done bool) (domain.Milestone, error) {
	var doneExpr string
	if done {
		doneExpr = "now()"
	} else {
		doneExpr = "NULL"
	}
	row := r.pool.QueryRow(ctx, fmt.Sprintf(`
		UPDATE user_milestones
		   SET done_at    = %s,
		       updated_at = now()
		 WHERE id = $1 AND user_id = $2
		 RETURNING id, goal_id, week_index, week_start, title, detail, category,
		           done_at, generated_at, updated_at`, doneExpr),
		sharedpg.UUID(milestoneID), sharedpg.UUID(userID),
	)
	var (
		id, goalID                       pgtype.UUID
		weekIndex                        int32
		weekStart                        time.Time
		title, detail, category          string
		doneAt                           pgtype.Timestamptz
		generatedAt, updatedAt           time.Time
	)
	if err := row.Scan(&id, &goalID, &weekIndex, &weekStart, &title, &detail, &category,
		&doneAt, &generatedAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Milestone{}, domain.ErrNotFound
		}
		return domain.Milestone{}, fmt.Errorf("intelligence.MilestonesPostgres.MarkDone: %w", err)
	}
	out := domain.Milestone{
		ID:          sharedpg.UUIDFrom(id),
		UserID:      userID,
		GoalID:      sharedpg.UUIDFrom(goalID),
		WeekIndex:   int(weekIndex),
		WeekStart:   weekStart,
		Title:       title,
		Detail:      detail,
		Category:    domain.MilestoneCategory(category),
		GeneratedAt: generatedAt,
		UpdatedAt:   updatedAt,
	}
	if doneAt.Valid {
		t := doneAt.Time
		out.DoneAt = &t
	}
	return out, nil
}

// LatestGenerationAt — MAX(generated_at) для (user, goal). Zero time если нет.
func (r *MilestonesPostgres) LatestGenerationAt(ctx context.Context, userID, goalID uuid.UUID) (time.Time, error) {
	var ts pgtype.Timestamptz
	err := r.pool.QueryRow(ctx,
		`SELECT MAX(generated_at)
		   FROM user_milestones
		  WHERE user_id = $1 AND goal_id = $2`,
		sharedpg.UUID(userID), sharedpg.UUID(goalID),
	).Scan(&ts)
	if err != nil {
		return time.Time{}, fmt.Errorf("intelligence.MilestonesPostgres.LatestGenerationAt: %w", err)
	}
	if !ts.Valid {
		return time.Time{}, nil
	}
	return ts.Time, nil
}

func scanMilestones(rows pgx.Rows, userID, goalID uuid.UUID) ([]domain.Milestone, error) {
	out := make([]domain.Milestone, 0, 12)
	for rows.Next() {
		var (
			id                            pgtype.UUID
			weekIndex                     int32
			weekStart                     time.Time
			title, detail, category       string
			doneAt                        pgtype.Timestamptz
			generatedAt, updatedAt        time.Time
		)
		if err := rows.Scan(&id, &weekIndex, &weekStart, &title, &detail, &category,
			&doneAt, &generatedAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scanMilestones: %w", err)
		}
		m := domain.Milestone{
			ID:          sharedpg.UUIDFrom(id),
			UserID:      userID,
			GoalID:      goalID,
			WeekIndex:   int(weekIndex),
			WeekStart:   weekStart,
			Title:       title,
			Detail:      detail,
			Category:    domain.MilestoneCategory(category),
			GeneratedAt: generatedAt,
			UpdatedAt:   updatedAt,
		}
		if doneAt.Valid {
			t := doneAt.Time
			m.DoneAt = &t
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scanMilestones rows: %w", err)
	}
	return out, nil
}

// Compile-time guard.
var _ domain.MilestoneRepo = (*MilestonesPostgres)(nil)
