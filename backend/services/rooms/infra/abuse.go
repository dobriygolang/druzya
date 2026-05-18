// abuse.go — AbuseChecker implementation backed by user_bans.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/rooms/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AbuseChecker rejects users with an active row in user_bans (manual admin
// ban). A domain_reputation per-share-link signal is out of scope for now
// — the CreateRoom API does not yet carry a recipient hostname.
type AbuseChecker struct {
	pool *pgxpool.Pool
}

func NewAbuseChecker(p *pgxpool.Pool) *AbuseChecker { return &AbuseChecker{pool: p} }

func (a *AbuseChecker) IsUserBlocked(ctx context.Context, userID uuid.UUID) (bool, error) {
	var blocked bool
	err := a.pool.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM user_bans
  WHERE user_id = $1
    AND lifted_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
)
`, userID).Scan(&blocked)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("rooms.AbuseChecker.IsUserBlocked: %w", err)
	}
	return blocked, nil
}

// Compile-time interface check.
var _ domain.AbuseChecker = (*AbuseChecker)(nil)
