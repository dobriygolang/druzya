// tutor_mode_repo.go — auxiliary read/write for the
// users.tutor_mode_enabled column.
//
// Why a separate file: keeping it out of settings_repo.go means the main
// Settings UPDATE doesn't depend on a regenerated sqlc query referencing
// the new column. The cost is one extra round-trip, which is fine for a
// profile-settings PUT (cold path, single-row write).
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/profile/domain"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/jackc/pgx/v5"
	"github.com/google/uuid"
)

// GetTutorModeEnabled reads the flag in isolation. Used by GetByUserID
// to enrich the Bundle without modifying the sqlc-generated bundle row.
func (p *Postgres) GetTutorModeEnabled(ctx context.Context, userID uuid.UUID) (bool, error) {
	var v bool
	err := p.pool.QueryRow(ctx,
		`SELECT COALESCE(tutor_mode_enabled, false) FROM users WHERE id = $1`,
		sharedpg.UUID(userID),
	).Scan(&v)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, fmt.Errorf("profile.Postgres.GetTutorModeEnabled: %w", domain.ErrNotFound)
		}
		return false, fmt.Errorf("profile.Postgres.GetTutorModeEnabled: %w", err)
	}
	return v, nil
}

// SetTutorModeEnabled writes the flag. Intended to be invoked by the
// UpdateSettings use case after the main settings tx commits (the field
// has its own HasTutorModeEnabled gate so partial PUTs don't clobber).
func (p *Postgres) SetTutorModeEnabled(ctx context.Context, userID uuid.UUID, enabled bool) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE users SET tutor_mode_enabled = $2, updated_at = now() WHERE id = $1`,
		sharedpg.UUID(userID), enabled,
	)
	if err != nil {
		return fmt.Errorf("profile.Postgres.SetTutorModeEnabled: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("profile.Postgres.SetTutorModeEnabled: %w", domain.ErrNotFound)
	}
	return nil
}
