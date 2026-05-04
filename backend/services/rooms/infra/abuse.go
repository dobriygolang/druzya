// abuse.go — AbuseChecker impl checks user_bans + domain_reputation.
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

// AbuseChecker — combined banned-user check.
//
//	user_bans active row → blocked (manual admin ban)
//
// Phase 9a §spam mitigation: пока domain_reputation per-share-link signal
// — postponed (нужен share-target hostname signal что отсутствует
// в API CreateRoom). Stage 1 = user_bans only.
type AbuseChecker struct {
	pool *pgxpool.Pool
}

func NewAbuseChecker(p *pgxpool.Pool) *AbuseChecker { return &AbuseChecker{pool: p} }

func (a *AbuseChecker) IsUserBlocked(ctx interface{}, userID uuid.UUID) (bool, error) {
	c := ctx.(context.Context)
	var blocked bool
	err := a.pool.QueryRow(c, `
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
