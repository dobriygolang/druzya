package domain

import "context"

// PublicStats are the platform headline counters surfaced by
// GET /api/v1/stats/public.
type PublicStats struct {
	UsersCount   int
	ActiveToday  int
	MatchesTotal int
}

// StatsRepo serves the public stats endpoint.
type StatsRepo interface {
	PublicStats(ctx context.Context) (PublicStats, error)
}
