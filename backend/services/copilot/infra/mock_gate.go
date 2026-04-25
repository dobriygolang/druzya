// Package infra — see postgres.go header.
//
// mock_gate.go implements domain.MockSessionGate by reading the `mock_sessions`
// table that lives in the ai_mock bounded context. This is the canonical
// cross-service read in the codebase: blocking Cue while a strict-mode mock
// is live is a cross-cutting integrity rule and we keep it on the consult
// side rather than as an ai_mock event broadcast. Plain pgx — no sqlc import
// from ai_mock to avoid coupling the two generated packages.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/copilot/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MockSessionGate is the postgres-backed implementation of
// domain.MockSessionGate. Phase-4 ADR-001 (Wave 3).
type MockSessionGate struct {
	pool *pgxpool.Pool
}

// NewMockSessionGate wraps a pool. The pool MUST be the same as ai_mock's
// (single monolith DB).
func NewMockSessionGate(pool *pgxpool.Pool) *MockSessionGate {
	return &MockSessionGate{pool: pool}
}

// Compile-time assertion.
var _ domain.MockSessionGate = (*MockSessionGate)(nil)

// HasActiveBlockingSession returns blocked=true when the user has a live
// (status NOT IN finished/abandoned) mock_sessions row with ai_assist=FALSE.
// `until` is best-effort: started_at + duration_min when both columns are
// populated, zero time otherwise.
func (g *MockSessionGate) HasActiveBlockingSession(
	ctx context.Context,
	userID uuid.UUID,
) (bool, time.Time, error) {
	const q = `
SELECT started_at, duration_min
  FROM mock_sessions
 WHERE user_id = $1
   AND ai_assist = FALSE
   AND status NOT IN ('finished', 'abandoned')
 ORDER BY created_at DESC
 LIMIT 1`

	var (
		startedAt   *time.Time
		durationMin int32
	)
	err := g.pool.QueryRow(ctx, q, userID).Scan(&startedAt, &durationMin)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, time.Time{}, nil
		}
		return false, time.Time{}, fmt.Errorf("copilot.MockSessionGate: %w", err)
	}
	var until time.Time
	if startedAt != nil && durationMin > 0 {
		until = startedAt.Add(time.Duration(durationMin) * time.Minute)
	}
	return true, until, nil
}
