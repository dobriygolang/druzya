//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// RatingRepo is the Postgres-backed persistence port for ratings.
type RatingRepo interface {
	// List returns every section rating for the user. Missing sections are
	// omitted (not backfilled with defaults at this layer).
	List(ctx context.Context, userID uuid.UUID) ([]SectionRating, error)

	// Upsert inserts or updates (user_id, section).
	Upsert(ctx context.Context, r SectionRating) error

	// Top returns the top-N for a section ordered by ELO DESC.
	Top(ctx context.Context, section enums.Section, limit int) ([]LeaderboardEntry, error)

	// FindRank returns the user's 1-based rank within a section (via ROW_NUMBER).
	// Returns 0 when the user has no row in the section.
	FindRank(ctx context.Context, userID uuid.UUID, section enums.Section) (int, error)

	// HistoryLast12Weeks returns weekly ELO snapshots for charting.
	// STUB: implementation may return empty until arena/mock supply samples.
	HistoryLast12Weeks(ctx context.Context, userID uuid.UUID) ([]HistorySample, error)
}

// LeaderboardCache is the Redis-backed cache port (Sorted Set per section).
type LeaderboardCache interface {
	// Get returns cached entries for (section, limit), or (nil, false) on miss.
	Get(ctx context.Context, section enums.Section, limit int) ([]LeaderboardEntry, bool, error)

	// Put stores the entries with a TTL.
	Put(ctx context.Context, section enums.Section, entries []LeaderboardEntry, ttl time.Duration) error
}
