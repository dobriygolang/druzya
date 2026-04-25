// status.go — public status page entities + repo contracts.
//
// The /status page is PUBLIC (no admin gate, no bearer auth) — it is the
// druz9 uptime/transparency surface. Two data sources:
//
//   - StatusProber.Probe — a synchronous health check against every
//     infrastructure component (Postgres, Redis, etc.). Slow components
//     (>250ms) are flagged "degraded"; failures are "down".
//   - IncidentRepo.Recent — last N rows of the `incidents` table for the
//     "Recent incidents" list.
//
// Uptime percentages are computed from the incident log: total downtime in
// the window divided by the window length, subtracted from 100%. Without a
// per-second up/down stream from Prometheus this is the best we can do
// today; a future iteration can swap in `prometheus.Range` queries here
// without touching the use case or the ports.
package domain

import (
	"context"
	"time"
)

// StatusOverall enumerates the aggregate page status.
type StatusOverall string

const (
	StatusOperational StatusOverall = "operational"
	StatusDegraded    StatusOverall = "degraded"
	StatusDown        StatusOverall = "down"
)

// StatusServiceState is the per-component health row.
type StatusServiceState struct {
	Name      string
	Slug      string
	Status    StatusOverall
	Uptime30D float64 // 0.0 – 100.0
	LatencyMS int64
}

// StatusIncident mirrors an incidents row.
type StatusIncident struct {
	ID               string
	Title            string
	Description      string
	Severity         string // minor / major / critical
	StartedAt        time.Time
	EndedAt          *time.Time
	AffectedServices []string
}

// StatusPage is the assembled response.
type StatusPage struct {
	OverallStatus StatusOverall
	Uptime90D     float64
	Services      []StatusServiceState
	Incidents     []StatusIncident
	GeneratedAt   time.Time
}

// StatusProber probes every infra component and returns their per-service
// state. Implementations MUST honour the ctx deadline — the public endpoint
// caps total work at ~2s.
type StatusProber interface {
	Probe(ctx context.Context) ([]StatusServiceState, error)
}

// IncidentRepo is the read-only adapter over the incidents table.
type IncidentRepo interface {
	Recent(ctx context.Context, limit int) ([]StatusIncident, error)
	// DowntimeSeconds returns the cumulative downtime (in seconds) over
	// `window`, as a sum over (ended_at - started_at) for incidents that
	// overlap the window. Open incidents (ended_at IS NULL) are clamped to
	// `now`.
	DowntimeSeconds(ctx context.Context, window time.Duration, now time.Time) (int64, error)
	// DailyBuckets returns a per-day status series (oldest → newest) of
	// length `days`, derived from the incidents log. If `slug` is empty the
	// page-wide worst status is reported; otherwise only incidents whose
	// affected_services contains `slug` are considered.
	DailyBuckets(ctx context.Context, slug string, days int, now time.Time) ([]StatusDayBucket, error)
}

// StatusDayBucket is one day of the per-service spark history.
type StatusDayBucket struct {
	Day    time.Time     // UTC start-of-day
	Status StatusOverall // ok if no incident touched the day
}
