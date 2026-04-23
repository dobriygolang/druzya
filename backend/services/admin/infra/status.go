// status.go — Postgres adapter for the public /status page (incidents)
// plus a live-probe StatusProber over Postgres + Redis.
//
// The prober is intentionally narrow: it only checks the dependencies the
// monolith owns directly. Components like MinIO, Judge0 or OpenRouter are
// flagged "operational" by default — a future iteration can plug in real
// HTTP probes here without touching the use case or the ports layer.
package infra

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/admin/domain"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// degradedThresholdMS — anything slower than this on a single probe is
// reported as "degraded" instead of "operational".
const degradedThresholdMS = 250

// Incidents is the read-only Postgres adapter over the incidents table.
type Incidents struct {
	pool *pgxpool.Pool
}

// NewIncidents wraps a pool.
func NewIncidents(pool *pgxpool.Pool) *Incidents { return &Incidents{pool: pool} }

// Recent returns the last `limit` incidents, newest first.
func (i *Incidents) Recent(ctx context.Context, limit int) ([]domain.StatusIncident, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := i.pool.Query(ctx, `
		SELECT id::text, title, description, severity, started_at, ended_at,
		       COALESCE(affected_services, ARRAY[]::text[])
		  FROM incidents
		 ORDER BY started_at DESC
		 LIMIT $1`, limit)
	if err != nil {
		// fresh environment without the migration applied — empty list.
		if isMissingRelation(err) {
			return []domain.StatusIncident{}, nil
		}
		return nil, fmt.Errorf("admin.Incidents.Recent: %w", err)
	}
	defer rows.Close()

	out := make([]domain.StatusIncident, 0, limit)
	for rows.Next() {
		var (
			rec     domain.StatusIncident
			started pgtype.Timestamptz
			ended   pgtype.Timestamptz
		)
		if err := rows.Scan(&rec.ID, &rec.Title, &rec.Description, &rec.Severity,
			&started, &ended, &rec.AffectedServices); err != nil {
			return nil, fmt.Errorf("admin.Incidents.Recent: scan: %w", err)
		}
		if started.Valid {
			rec.StartedAt = started.Time.UTC()
		}
		if ended.Valid {
			t := ended.Time.UTC()
			rec.EndedAt = &t
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin.status.rows.Err: %w", err)
	}
	return out, nil
}

// DowntimeSeconds sums the overlapping-with-window portion of every
// incident, clamping open incidents to `now`. Severity does not weight
// the calculation (treat any incident as a full outage for uptime maths).
func (i *Incidents) DowntimeSeconds(ctx context.Context, window time.Duration, now time.Time) (int64, error) {
	if window <= 0 {
		return 0, nil
	}
	since := now.Add(-window).UTC()
	var seconds int64
	err := i.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(
		  EXTRACT(EPOCH FROM (LEAST(COALESCE(ended_at, $2::timestamptz), $2::timestamptz)
		                       - GREATEST(started_at, $1::timestamptz)))
		)::bigint, 0)
		  FROM incidents
		 WHERE COALESCE(ended_at, $2::timestamptz) >= $1::timestamptz
		   AND started_at <= $2::timestamptz`,
		since, now.UTC()).Scan(&seconds)
	if err != nil {
		if isMissingRelation(err) {
			return 0, nil
		}
		return 0, fmt.Errorf("admin.Incidents.DowntimeSeconds: %w", err)
	}
	if seconds < 0 {
		seconds = 0
	}
	return seconds, nil
}

// Compile-time assertion.
var _ domain.IncidentRepo = (*Incidents)(nil)

// ─────────────────────────────────────────────────────────────────────────
// Live probe over Postgres + Redis (and a few static "operational" rows
// for components we don't directly own).
// ─────────────────────────────────────────────────────────────────────────

// StatusProber is the live-probe implementation.
type StatusProber struct {
	pool *pgxpool.Pool
	rdb  *redis.Client
	// Recent incident counts feed the per-service uptime% so a long active
	// incident reflects on its component cards.
	incidents domain.IncidentRepo
	// extraServices are infra components we cannot probe directly (judge0,
	// minio, openrouter). They appear on the page as "operational" unless
	// an active incident touches them.
	extraServices []extraService
}

type extraService struct {
	Name string
	Slug string
}

// NewStatusProber wires the prober.
func NewStatusProber(pool *pgxpool.Pool, rdb *redis.Client, inc domain.IncidentRepo) *StatusProber {
	return &StatusProber{
		pool: pool, rdb: rdb, incidents: inc,
		extraServices: []extraService{
			{Name: "Web App", Slug: "web"},
			{Name: "REST API", Slug: "api"},
			{Name: "WebSocket", Slug: "ws"},
			{Name: "MinIO", Slug: "minio"},
			{Name: "Judge0", Slug: "judge0"},
			{Name: "OpenRouter", Slug: "openrouter"},
		},
	}
}

// Probe runs each check sequentially under the inherited deadline. Returns
// a slice ordered for the UI: web/api/ws first, then PG/Redis, then the
// extras.
func (p *StatusProber) Probe(ctx context.Context) ([]domain.StatusServiceState, error) {
	out := make([]domain.StatusServiceState, 0, 8)

	// PostgreSQL probe — Ping with a tight 1s sub-deadline.
	out = append(out, p.probePostgres(ctx))
	// Redis probe.
	out = append(out, p.probeRedis(ctx))

	// Pull recent incidents to flag affected extras as "degraded" / "down".
	activeBySlug := map[string]string{}
	if p.incidents != nil {
		if recent, err := p.incidents.Recent(ctx, 25); err == nil {
			for _, inc := range recent {
				if inc.EndedAt != nil {
					continue
				}
				sev := mapSeverityToStatus(inc.Severity)
				for _, s := range inc.AffectedServices {
					if existing := activeBySlug[s]; statusRank(sev) > statusRank(existing) {
						activeBySlug[s] = sev
					}
				}
			}
		}
	}

	for _, e := range p.extraServices {
		st := string(domain.StatusOperational)
		if v, ok := activeBySlug[e.Slug]; ok && v != "" {
			st = v
		}
		out = append(out, domain.StatusServiceState{
			Name:      e.Name,
			Slug:      e.Slug,
			Status:    domain.StatusOverall(st),
			Uptime30D: uptimePercent(activeBySlug[e.Slug] != ""),
		})
	}
	return out, nil
}

func (p *StatusProber) probePostgres(ctx context.Context) domain.StatusServiceState {
	state := domain.StatusServiceState{Name: "PostgreSQL", Slug: "postgres", Status: domain.StatusOperational, Uptime30D: 100}
	if p.pool == nil {
		state.Status = domain.StatusDown
		state.Uptime30D = 0
		return state
	}
	probeCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	t0 := time.Now()
	err := p.pool.Ping(probeCtx)
	state.LatencyMS = time.Since(t0).Milliseconds()
	if err != nil {
		state.Status = domain.StatusDown
		state.Uptime30D = 99.0 // best-effort placeholder until real history lands
		return state
	}
	if state.LatencyMS > degradedThresholdMS {
		state.Status = domain.StatusDegraded
		state.Uptime30D = 99.5
	}
	return state
}

func (p *StatusProber) probeRedis(ctx context.Context) domain.StatusServiceState {
	state := domain.StatusServiceState{Name: "Redis", Slug: "redis", Status: domain.StatusOperational, Uptime30D: 100}
	if p.rdb == nil {
		state.Status = domain.StatusDown
		state.Uptime30D = 0
		return state
	}
	probeCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	t0 := time.Now()
	err := p.rdb.Ping(probeCtx).Err()
	state.LatencyMS = time.Since(t0).Milliseconds()
	if err != nil {
		state.Status = domain.StatusDown
		state.Uptime30D = 99.0
		return state
	}
	if state.LatencyMS > degradedThresholdMS {
		state.Status = domain.StatusDegraded
		state.Uptime30D = 99.5
	}
	return state
}

// statusRank gives precedence — higher = worse — so a component touched by
// a "down" incident is reported as down even if another open incident only
// degrades it.
func statusRank(s string) int {
	switch strings.ToLower(s) {
	case string(domain.StatusDown):
		return 3
	case string(domain.StatusDegraded):
		return 2
	case string(domain.StatusOperational):
		return 1
	}
	return 0
}

func mapSeverityToStatus(sev string) string {
	switch strings.ToLower(sev) {
	case "critical":
		return string(domain.StatusDown)
	case "major":
		return string(domain.StatusDegraded)
	case "minor":
		return string(domain.StatusDegraded)
	}
	return string(domain.StatusOperational)
}

// uptimePercent returns 100% when there's no current trouble, 99.5% when
// an open incident touches the component. A rougher approximation than
// real metrics, but it gives the user something honest to look at.
func uptimePercent(touchedByActiveIncident bool) float64 {
	if touchedByActiveIncident {
		return 99.5
	}
	return 100.0
}

// Compile-time assertion.
var _ domain.StatusProber = (*StatusProber)(nil)
