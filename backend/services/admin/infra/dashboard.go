// dashboard.go — Postgres adapter for the admin dashboard counters.
//
// One round-trip per counter (12 parallel-friendly queries). All queries
// are read-only and very cheap — we run them sequentially to keep the code
// simple; the use case caches the result for 60s so we never hit Postgres
// more than once per minute under steady load.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/admin/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Dashboard is the persistence adapter for the dashboard counters.
type Dashboard struct {
	pool *pgxpool.Pool
}

// NewDashboard wraps a pool.
func NewDashboard(pool *pgxpool.Pool) *Dashboard { return &Dashboard{pool: pool} }

// Snapshot fans out the count queries and assembles a single payload.
//
// Counters from optional tables (mock_sessions, daily_kata_history,
// anticheat_signals, user_reports, user_bans, arena_matches) tolerate
// "table does not exist" — a fresh environment without those migrations
// applied still returns a valid (zero-counter) response. This mirrors the
// resilience pattern in stats.go's /stats/public.
func (d *Dashboard) Snapshot(ctx context.Context, now time.Time) (domain.AdminDashboard, error) {
	out := domain.AdminDashboard{GeneratedAt: now.UTC()}

	queries := []struct {
		dst *int64
		sql string
	}{
		{&out.UsersTotal, `SELECT COUNT(*)::bigint FROM users`},
		{&out.UsersActiveToday, `SELECT COUNT(*)::bigint FROM users WHERE updated_at >= now() - interval '24 hours'`},
		{&out.UsersActiveWeek, `SELECT COUNT(*)::bigint FROM users WHERE updated_at >= now() - interval '7 days'`},
		{&out.UsersActiveMonth, `SELECT COUNT(*)::bigint FROM users WHERE updated_at >= now() - interval '30 days'`},
		{&out.UsersBanned, `SELECT COUNT(*)::bigint FROM user_bans
		                     WHERE lifted_at IS NULL
		                       AND (expires_at IS NULL OR expires_at > now())`},
		{&out.MatchesToday, `SELECT COUNT(*)::bigint FROM arena_matches WHERE created_at >= now() - interval '24 hours'`},
		{&out.MatchesWeek, `SELECT COUNT(*)::bigint FROM arena_matches WHERE created_at >= now() - interval '7 days'`},
		{&out.KatasToday, `SELECT COUNT(*)::bigint FROM daily_kata_history WHERE submitted_at >= now() - interval '24 hours' AND passed = TRUE`},
		{&out.KatasWeek, `SELECT COUNT(*)::bigint FROM daily_kata_history WHERE submitted_at >= now() - interval '7 days' AND passed = TRUE`},
		{&out.ActiveMockSessions, `SELECT COUNT(*)::bigint FROM mock_sessions WHERE status = 'in_progress'`},
		{&out.ActiveArenaMatches, `SELECT COUNT(*)::bigint FROM arena_matches WHERE status IN ('searching','confirming','active')`},
		{&out.ReportsPending, `SELECT COUNT(*)::bigint FROM user_reports WHERE status = 'pending'`},
		{&out.AnticheatSignals24h, `SELECT COUNT(*)::bigint FROM anticheat_signals WHERE created_at >= now() - interval '24 hours'`},
	}
	for _, q := range queries {
		if err := d.pool.QueryRow(ctx, q.sql).Scan(q.dst); err != nil {
			// Tolerate "missing table / column" so the endpoint stays usable
			// in fresh environments before every migration is applied. Log
			// would belong here but the use case decides whether to log.
			if isMissingRelation(err) || errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return domain.AdminDashboard{}, fmt.Errorf("admin.Dashboard.Snapshot: %w", err)
		}
	}
	return out, nil
}

// Compile-time assertion.
var _ domain.DashboardRepo = (*Dashboard)(nil)
