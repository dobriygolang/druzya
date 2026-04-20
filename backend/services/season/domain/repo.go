//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"

	"github.com/google/uuid"
)

// SeasonRepo is the persistence port for seasons + season_progress.
type SeasonRepo interface {
	// GetCurrent returns the row flagged is_current = TRUE, or ErrNoCurrent
	// when the seed hasn't run / the admin has closed every season.
	GetCurrent(ctx context.Context) (Season, error)

	// GetProgress loads (user, season). Missing rows must return a zeroed
	// Progress struct (Points=0, Tier=0) — not ErrNotFound — so callers can
	// treat a fresh user identically to a lapsed one.
	GetProgress(ctx context.Context, userID, seasonID uuid.UUID) (Progress, error)

	// IncrementPoints atomically bumps (user, season) by delta SP and returns
	// the new Points total. Implementations MUST upsert with ON CONFLICT.
	IncrementPoints(ctx context.Context, userID, seasonID uuid.UUID, delta int) (int, error)

	// UpdateTier writes the recomputed tier back to the row. Called after a
	// points increment once the caller has recomputed the tier in-memory.
	UpdateTier(ctx context.Context, userID, seasonID uuid.UUID, tier int) error
}

// ChallengeRepo is a read-only port for weekly challenge definitions.
// Implementations are expected to return the active set for the given week,
// driven by the hardcoded static_config today and a CMS table tomorrow.
type ChallengeRepo interface {
	// List returns every challenge defined for the season.
	List(ctx context.Context, seasonID uuid.UUID) ([]WeeklyChallenge, error)

	// Active returns only the subset live for the given ISO week. A challenge
	// with IsoWeek == 0 is considered "active every week".
	Active(ctx context.Context, seasonID uuid.UUID, isoWeek int) ([]WeeklyChallenge, error)
}

// TierRepo is a read-only port for per-track tier definitions.
// Implementations are expected to return the hardcoded struct literal today.
type TierRepo interface {
	// Tracks returns the tier ladder for a single track. Must be sorted by
	// RequiredPoints ASC.
	Tracks(ctx context.Context, seasonID uuid.UUID, kind TrackKind) ([]TierDef, error)
}

// ClaimRepo tracks which tiers the user has redeemed.
//
// STUB: MVP implementation keeps claims in-memory. A future migration adds a
// `season_reward_claims` table.
type ClaimRepo interface {
	Get(ctx context.Context, userID, seasonID uuid.UUID) (ClaimState, error)
	MarkClaimed(ctx context.Context, userID, seasonID uuid.UUID, kind TrackKind, tier int) error
}
