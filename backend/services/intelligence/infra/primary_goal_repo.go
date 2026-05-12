// primary_goal_repo.go — pgx adapter over user_primary_goals (migration 00086).
//
// Single-active invariant enforced at DB layer via partial unique index
// (user_primary_goals_active_per_user). Insert wraps in tx, deactivating
// prior active row before INSERT, чтобы избежать race window между
// DELETE-then-INSERT.
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

// PrimaryGoals — pgx-backed PrimaryGoalRepo.
type PrimaryGoals struct{ pool *pgxpool.Pool }

// NewPrimaryGoals wires the adapter.
func NewPrimaryGoals(pool *pgxpool.Pool) *PrimaryGoals {
	return &PrimaryGoals{pool: pool}
}

// Insert atomically deactivates прежний active goal + creates a new one.
// Done в одной tx чтобы partial unique index не упал между UPDATE и INSERT.
func (r *PrimaryGoals) Insert(ctx context.Context, in domain.PrimaryGoal) (domain.PrimaryGoal, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.PrimaryGoals.Insert begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`UPDATE user_primary_goals
		    SET active = FALSE, updated_at = now()
		  WHERE user_id = $1 AND active = TRUE`,
		sharedpg.UUID(in.UserID),
	); err != nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.PrimaryGoals.Insert deactivate prior: %w", err)
	}

	var (
		id                   pgtype.UUID
		createdAt, updatedAt time.Time
	)
	if err := tx.QueryRow(ctx, `
		INSERT INTO user_primary_goals
		    (user_id, kind, target_company, target_level, target_text,
		     target_date, active)
		VALUES ($1, $2, $3, $4, $5, $6, TRUE)
		RETURNING id, created_at, updated_at`,
		sharedpg.UUID(in.UserID),
		string(in.Kind),
		nullableText(in.TargetCompany),
		nullableText(in.TargetLevel),
		nullableText(in.TargetText),
		nullableDate(in.TargetDate),
	).Scan(&id, &createdAt, &updatedAt); err != nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.PrimaryGoals.Insert: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.PrimaryGoals.Insert commit: %w", err)
	}

	out := in
	out.ID = sharedpg.UUIDFrom(id)
	out.Active = true
	out.CreatedAt = createdAt
	out.UpdatedAt = updatedAt
	return out, nil
}

// GetActive returns the single active goal for user, or ErrNotFound.
func (r *PrimaryGoals) GetActive(ctx context.Context, userID uuid.UUID) (domain.PrimaryGoal, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, kind,
		       COALESCE(target_company, ''),
		       COALESCE(target_level,   ''),
		       COALESCE(target_text,    ''),
		       target_date, active, created_at, updated_at
		  FROM user_primary_goals
		 WHERE user_id = $1 AND active = TRUE
		 LIMIT 1`,
		sharedpg.UUID(userID),
	)
	g, err := scanPrimaryGoal(row, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.PrimaryGoal{}, domain.ErrNotFound
		}
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.PrimaryGoals.GetActive: %w", err)
	}
	return g, nil
}

// UpdateByID updates the row identified by (in.ID, in.UserID). active is
// preserved (use DeactivateByID to flip).
func (r *PrimaryGoals) UpdateByID(ctx context.Context, in domain.PrimaryGoal) (domain.PrimaryGoal, error) {
	row := r.pool.QueryRow(ctx, `
		UPDATE user_primary_goals
		   SET kind           = $3,
		       target_company = $4,
		       target_level   = $5,
		       target_text    = $6,
		       target_date    = $7,
		       updated_at     = now()
		 WHERE id = $1 AND user_id = $2
		 RETURNING id, kind,
		           COALESCE(target_company, ''),
		           COALESCE(target_level,   ''),
		           COALESCE(target_text,    ''),
		           target_date, active, created_at, updated_at`,
		sharedpg.UUID(in.ID),
		sharedpg.UUID(in.UserID),
		string(in.Kind),
		nullableText(in.TargetCompany),
		nullableText(in.TargetLevel),
		nullableText(in.TargetText),
		nullableDate(in.TargetDate),
	)
	g, err := scanPrimaryGoal(row, in.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.PrimaryGoal{}, domain.ErrNotFound
		}
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.PrimaryGoals.UpdateByID: %w", err)
	}
	return g, nil
}

// DeactivateByID flips active=false. ErrNotFound if no row affected.
func (r *PrimaryGoals) DeactivateByID(ctx context.Context, userID, goalID uuid.UUID) error {
	cmd, err := r.pool.Exec(ctx, `
		UPDATE user_primary_goals
		   SET active = FALSE, updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND active = TRUE`,
		sharedpg.UUID(goalID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("intelligence.PrimaryGoals.DeactivateByID: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ── helpers ──────────────────────────────────────────────────────────────

// scanPrimaryGoal — общий scanner для GetActive/UpdateByID. userID
// прокидывается обратно в struct (БД не возвращает его в RETURNING).
type rowScanner interface {
	Scan(dest ...any) error
}

func scanPrimaryGoal(row rowScanner, userID uuid.UUID) (domain.PrimaryGoal, error) {
	var (
		id                                       pgtype.UUID
		kind                                     string
		company, level, text                     string
		targetDate                               pgtype.Date
		active                                   bool
		createdAt, updatedAt                     time.Time
	)
	if err := row.Scan(&id, &kind, &company, &level, &text,
		&targetDate, &active, &createdAt, &updatedAt); err != nil {
		return domain.PrimaryGoal{}, err
	}
	g := domain.PrimaryGoal{
		ID:            sharedpg.UUIDFrom(id),
		UserID:        userID,
		Kind:          domain.PrimaryGoalKind(kind),
		TargetCompany: company,
		TargetLevel:   level,
		TargetText:    text,
		Active:        active,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
	}
	if targetDate.Valid {
		t := targetDate.Time
		g.TargetDate = &t
	}
	return g, nil
}

func nullableText(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// nullableDate lives в cross_readers.go (same package).

// Compile-time guard.
var _ domain.PrimaryGoalRepo = (*PrimaryGoals)(nil)
