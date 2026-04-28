// rate_limit.go — distributed RunCode quota.
//
// Two fixed-window buckets per user:
//
//   - per-minute (default 10 runs / 60 s) — protects Judge0 from
//     accidental loops and burst abuse
//   - per-day (default 200 runs / 24 h) — caps the cost a single
//     account can impose on the shared sandbox over a working day
//
// Both run atop shared/pkg/ratelimit.RedisFixedWindow; the per-day key
// embeds the calendar date so it auto-rolls at UTC midnight without an
// explicit reset job. RetryAfterSec is the smaller of the two TTLs, so
// the client sees the soonest next opportunity.
package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/editor/domain"
	"druz9/shared/pkg/ratelimit"

	"github.com/google/uuid"
)

// Defaults; the wirer can override.
const (
	DefaultRunCodeMinuteCap = 10
	DefaultRunCodeDayCap    = 200
)

// RedisRunCodeLimiter implements domain.RunCodeRateLimiter using two
// Redis fixed-window buckets keyed by user id.
type RedisRunCodeLimiter struct {
	rl        *ratelimit.RedisFixedWindow
	minuteCap int
	dayCap    int
	now       func() time.Time
}

// NewRedisRunCodeLimiter wires a limiter. Zero/negative caps fall back to
// the defaults. now is optional (defaults to time.Now); injecting it keeps
// tests deterministic across day rollovers.
func NewRedisRunCodeLimiter(rl *ratelimit.RedisFixedWindow, minuteCap, dayCap int) *RedisRunCodeLimiter {
	if rl == nil {
		panic("editor.infra.NewRedisRunCodeLimiter: redis limiter required")
	}
	if minuteCap <= 0 {
		minuteCap = DefaultRunCodeMinuteCap
	}
	if dayCap <= 0 {
		dayCap = DefaultRunCodeDayCap
	}
	return &RedisRunCodeLimiter{rl: rl, minuteCap: minuteCap, dayCap: dayCap, now: time.Now}
}

// Allow consumes one token from each bucket atomically (sequentially —
// minute first, then day). On exhaustion returns the smaller retry hint.
func (l *RedisRunCodeLimiter) Allow(ctx context.Context, userID uuid.UUID) (bool, int, error) {
	if userID == uuid.Nil {
		return false, 0, fmt.Errorf("editor.RedisRunCodeLimiter.Allow: empty user id")
	}
	uid := userID.String()
	minRes, err := l.rl.Allow(ctx, "runcode:min:"+uid, l.minuteCap, time.Minute)
	if err != nil {
		return false, 0, fmt.Errorf("editor.RedisRunCodeLimiter.Allow: minute: %w", err)
	}
	if !minRes.Allowed {
		return false, minRes.RetryAfterSec, nil
	}
	// Day bucket key embeds the UTC date so it rolls cleanly without a
	// reset job; TTL of 24h covers any clock skew between workers.
	day := l.now().UTC().Format("2006-01-02")
	dayRes, err := l.rl.Allow(ctx, "runcode:day:"+day+":"+uid, l.dayCap, 24*time.Hour)
	if err != nil {
		return false, 0, fmt.Errorf("editor.RedisRunCodeLimiter.Allow: day: %w", err)
	}
	if !dayRes.Allowed {
		return false, dayRes.RetryAfterSec, nil
	}
	return true, 0, nil
}

// Compile-time guard.
var _ domain.RunCodeRateLimiter = (*RedisRunCodeLimiter)(nil)
