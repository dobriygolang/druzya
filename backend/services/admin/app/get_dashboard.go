// get_dashboard.go — read-only dashboard counters with a 60s Redis cache.
//
// Cache key: "admin:v1:dashboard". TTL 60s. Cache-miss assembles the
// snapshot via DashboardRepo and stores the JSON envelope.
//
// On Redis errors we fall through to a direct DB hit — a partial outage on
// Redis must not take the admin landing page offline.
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

// DashboardCacheKey is the Redis key holding the latest dashboard snapshot.
const DashboardCacheKey = "admin:v1:dashboard"

// DashboardCacheTTL is the maximum staleness for the cached snapshot.
const DashboardCacheTTL = 60 * time.Second

// GetDashboard implements GET /api/v1/admin/dashboard.
type GetDashboard struct {
	Repo  domain.DashboardRepo
	Cache *redis.Client
	Log   *slog.Logger
	Now   func() time.Time
}

// Do returns a snapshot, preferring the cache.
func (uc *GetDashboard) Do(ctx context.Context) (domain.AdminDashboard, error) {
	now := uc.now()
	if uc.Cache != nil {
		raw, err := uc.Cache.Get(ctx, DashboardCacheKey).Bytes()
		switch {
		case err == nil && len(raw) > 0:
			var cached domain.AdminDashboard
			if jerr := json.Unmarshal(raw, &cached); jerr == nil {
				return cached, nil
			} else if uc.Log != nil {
				// Corrupted payload — fall through to DB and overwrite.
				uc.Log.WarnContext(ctx, "admin.GetDashboard: cache decode failed", slog.Any("err", jerr))
			}
		case err != nil && !errors.Is(err, redis.Nil):
			if uc.Log != nil {
				uc.Log.WarnContext(ctx, "admin.GetDashboard: cache get failed", slog.Any("err", err))
			}
		}
	}

	snap, err := uc.Repo.Snapshot(ctx, now)
	if err != nil {
		return domain.AdminDashboard{}, fmt.Errorf("admin.GetDashboard: %w", err)
	}
	if uc.Cache != nil {
		if payload, mErr := json.Marshal(snap); mErr == nil {
			if sErr := uc.Cache.Set(ctx, DashboardCacheKey, payload, DashboardCacheTTL).Err(); sErr != nil && uc.Log != nil {
				uc.Log.WarnContext(ctx, "admin.GetDashboard: cache set failed", slog.Any("err", sErr))
			}
		}
	}
	return snap, nil
}

func (uc *GetDashboard) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now()
}
