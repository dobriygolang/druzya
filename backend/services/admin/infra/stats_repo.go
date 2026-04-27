// stats_repo.go — Postgres adapter for /api/v1/stats/public counters.
//
// Three SELECT count(*) round-trips kept verbatim from
// cmd/monolith/services/admin/stats.go. The arena_matches probe
// deliberately swallows errors so a missing table simply leaves the
// counter at zero (resilient to fresh environments).
package infra

import (
	"context"
	"log/slog"

	"druz9/admin/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Stats is the persistence adapter for the public stats endpoint.
type Stats struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

// NewStats wraps a pool. log may be nil.
func NewStats(pool *pgxpool.Pool, log *slog.Logger) *Stats {
	return &Stats{pool: pool, log: log}
}

// PublicStats runs the three count queries and assembles the response.
func (s *Stats) PublicStats(ctx context.Context) (domain.PublicStats, error) {
	resp := domain.PublicStats{}
	if s.pool == nil {
		return resp, nil
	}

	// users
	var n int
	row := s.pool.QueryRow(ctx, `SELECT count(*)::int FROM users`)
	if err := row.Scan(&n); err != nil {
		if s.log != nil {
			s.log.WarnContext(ctx, "stats.publicStats: count users", slog.Any("err", err))
		}
	} else {
		resp.UsersCount = n
	}

	// active today: users updated in last 24h.
	var active int
	row = s.pool.QueryRow(ctx,
		`SELECT count(*)::int FROM users WHERE updated_at >= now() - interval '24 hours'`)
	if err := row.Scan(&active); err != nil {
		if s.log != nil {
			s.log.WarnContext(ctx, "stats.publicStats: count active", slog.Any("err", err))
		}
	} else {
		resp.ActiveToday = active
	}

	// matches total — arena_matches if it exists; absorb any error so
	// the endpoint stays resilient when the table is missing.
	var matches int
	row = s.pool.QueryRow(ctx, `SELECT count(*)::int FROM arena_matches`)
	if err := row.Scan(&matches); err != nil {
		resp.MatchesTotal = 0
	} else {
		resp.MatchesTotal = matches
	}
	return resp, nil
}

var _ domain.StatsRepo = (*Stats)(nil)
