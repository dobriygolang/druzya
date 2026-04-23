// get_status.go — public /status page assembler with a 30s Redis cache.
//
// Cache key: "admin:v1:status". TTL 30s — short enough that a recent
// outage shows up promptly, long enough that we don't burn a Postgres
// ping on every refresh from anonymous visitors.
//
// Uptime% is computed from the incident log:
//
//	uptime = (window - downtime) / window * 100
//
// Without a real Prometheus `up` series this is the best honest answer we
// can give from in-process data alone.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/admin/domain"

	"github.com/redis/go-redis/v9"
)

// StatusCacheKey is the Redis key holding the latest /status snapshot.
const StatusCacheKey = "admin:v1:status"

// StatusCacheTTL is the maximum staleness for the cached status payload.
const StatusCacheTTL = 30 * time.Second

// MaxIncidentsOnPage caps the "Recent incidents" list shown publicly so a
// long historical tail doesn't bloat the JSON.
const MaxIncidentsOnPage = 10

// uptime90DWindow is the look-back window used for the headline uptime%.
const uptime90DWindow = 90 * 24 * time.Hour

// GetStatus implements GET /api/v1/status (PUBLIC).
type GetStatus struct {
	Prober    domain.StatusProber
	Incidents domain.IncidentRepo
	Cache     *redis.Client
	Log       *slog.Logger
	Now       func() time.Time
}

// Do assembles a fresh snapshot, preferring the cache.
func (uc *GetStatus) Do(ctx context.Context) (domain.StatusPage, error) {
	if uc.Cache != nil {
		raw, err := uc.Cache.Get(ctx, StatusCacheKey).Bytes()
		switch {
		case err == nil && len(raw) > 0:
			var cached domain.StatusPage
			if jerr := json.Unmarshal(raw, &cached); jerr == nil {
				return cached, nil
			} else if uc.Log != nil {
				uc.Log.WarnContext(ctx, "admin.GetStatus: cache decode failed", slog.Any("err", jerr))
			}
		case err != nil && !errors.Is(err, redis.Nil):
			if uc.Log != nil {
				uc.Log.WarnContext(ctx, "admin.GetStatus: cache get failed", slog.Any("err", err))
			}
		}
	}

	now := uc.now()
	page := domain.StatusPage{GeneratedAt: now.UTC()}

	services, err := uc.Prober.Probe(ctx)
	if err != nil {
		return domain.StatusPage{}, fmt.Errorf("admin.GetStatus: probe: %w", err)
	}
	page.Services = services
	page.OverallStatus = aggregate(services)

	if uc.Incidents != nil {
		recent, ierr := uc.Incidents.Recent(ctx, MaxIncidentsOnPage)
		if ierr != nil && uc.Log != nil {
			uc.Log.WarnContext(ctx, "admin.GetStatus: incidents fetch failed", slog.Any("err", ierr))
		}
		page.Incidents = recent
		downtime, derr := uc.Incidents.DowntimeSeconds(ctx, uptime90DWindow, now)
		if derr != nil && uc.Log != nil {
			uc.Log.WarnContext(ctx, "admin.GetStatus: downtime calc failed", slog.Any("err", derr))
		}
		page.Uptime90D = uptimePercent(downtime, uptime90DWindow)
	} else {
		page.Uptime90D = 100.0
	}

	if uc.Cache != nil {
		if payload, mErr := json.Marshal(page); mErr == nil {
			if sErr := uc.Cache.Set(ctx, StatusCacheKey, payload, StatusCacheTTL).Err(); sErr != nil && uc.Log != nil {
				uc.Log.WarnContext(ctx, "admin.GetStatus: cache set failed", slog.Any("err", sErr))
			}
		}
	}
	return page, nil
}

func (uc *GetStatus) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now()
}

// aggregate folds per-service states into a single page-wide status.
// Worst-case wins: any "down" → page is down; any "degraded" → degraded;
// otherwise "operational".
func aggregate(svcs []domain.StatusServiceState) domain.StatusOverall {
	rank := func(s domain.StatusOverall) int {
		switch s {
		case domain.StatusDown:
			return 3
		case domain.StatusDegraded:
			return 2
		case domain.StatusOperational:
			return 1
		}
		return 0
	}
	worst := domain.StatusOperational
	for _, s := range svcs {
		if rank(s.Status) > rank(worst) {
			worst = s.Status
		}
	}
	return worst
}

// uptimePercent computes the headline uptime over `window` from a downtime
// total in seconds. Clamps to [0, 100].
func uptimePercent(downtimeSec int64, window time.Duration) float64 {
	totalSec := window.Seconds()
	if totalSec <= 0 {
		return 100.0
	}
	pct := (totalSec - float64(downtimeSec)) / totalSec * 100.0
	if pct < 0 {
		return 0
	}
	if pct > 100 {
		return 100
	}
	return pct
}
