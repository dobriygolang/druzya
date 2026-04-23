// dashboard.go — admin dashboard entity + repository contract.
//
// The dashboard surface is a simple counters payload assembled from several
// tables (users / arena_matches / mock_sessions / daily_kata_history /
// anticheat_signals / user_reports). The repo runs every query in a single
// short-lived ctx so the use case can wrap the whole thing in a Redis cache
// (60s TTL — see app/get_dashboard.go).
//
// Active timeframes are computed off users.updated_at as a coarse proxy
// (mirrors the `/stats/public` endpoint in cmd/monolith/services/stats.go).
// When/if a real `user_sessions` table lands, the repo can swap the source
// without touching the domain or the use case.
package domain

import (
	"context"
	"time"
)

// AdminDashboard is the live counters payload served by the /admin landing.
type AdminDashboard struct {
	UsersTotal          int64
	UsersActiveToday    int64
	UsersActiveWeek     int64
	UsersActiveMonth    int64
	UsersBanned         int64
	MatchesToday        int64
	MatchesWeek         int64
	KatasToday          int64
	KatasWeek           int64
	ActiveMockSessions  int64
	ActiveArenaMatches  int64
	ReportsPending      int64
	AnticheatSignals24h int64
	GeneratedAt         time.Time
}

// DashboardRepo serves admin dashboard counters.
type DashboardRepo interface {
	Snapshot(ctx context.Context, now time.Time) (AdminDashboard, error)
}
