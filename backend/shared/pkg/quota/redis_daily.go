// Package quota tracks per-user LLM token consumption on a daily
// window. Purpose: cap worst-case cost per account when rate limits
// alone don't — a compromised session can burn 60 req/min × 1440
// min = 86k requests in a day, which at 180 tokens each would rack
// up a big Groq bill even on free-tier shared quotas.
//
// Key schema: `quota:tokens:{userID}:{YYYY-MM-DD}` → INCR counter.
// TTL is set on first increment to 48h (generous buffer past UTC
// day rollover so timezone sloppiness can't let a counter persist
// stale or get lost mid-day).
//
// Failure mode: fail-open on Redis transport errors (same policy as
// rate-limit and kill-switch). An outage on Redis should not lock
// users out; operator monitoring catches the incident via unrelated
// signals. The "check" is advisory — callers pass the returned
// error up to the handler which renders 429.
package quota

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// ErrDailyQuotaExceeded is returned by Check when the user has
// spent past their daily cap. Callers wrap for HTTP mapping (429 +
// Retry-After set to seconds-until-UTC-midnight).
var ErrDailyQuotaExceeded = errors.New("quota: daily token cap exceeded")

// DailyTokenQuota is the user-scoped counter. Construct one per
// service (copilot, suggestion, etc.) — they share the Redis client
// but can each carry a different cap if needed.
type DailyTokenQuota struct {
	rdb *redis.Client
	cap int
}

// New returns a quota with the given daily cap. cap ≤ 0 disables the
// quota (all Check calls return nil) — useful for per-plan
// configuration where paid tiers have "unlimited".
func New(rdb *redis.Client, cap int) *DailyTokenQuota {
	return &DailyTokenQuota{rdb: rdb, cap: cap}
}

// Check returns ErrDailyQuotaExceeded if the user's counter is at
// or above cap. Nil-safe on receiver (returns nil); nil-Redis also
// returns nil.
func (q *DailyTokenQuota) Check(ctx context.Context, userID uuid.UUID) error {
	if q == nil || q.rdb == nil || q.cap <= 0 {
		return nil
	}
	// Short ctx — this sits on the hot path before LLM stream.
	ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
	defer cancel()
	n, err := q.rdb.Get(ctx, key(userID)).Int()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil // no usage yet today
		}
		// Fail-open on transport errors.
		return nil
	}
	if n >= q.cap {
		return fmt.Errorf("%w: used %d of %d tokens", ErrDailyQuotaExceeded, n, q.cap)
	}
	return nil
}

// Consume increments the user's counter by `tokens`. Called AFTER the
// LLM stream completes (so we charge actual usage, not estimates).
// Errors are logged by the caller and do not propagate — a missed
// increment is a billing accuracy issue, not a correctness one.
//
// TTL is reapplied on every call to handle edge cases where the key
// was manually reset: we re-arm the 48h window instead of letting it
// expire mid-day.
func (q *DailyTokenQuota) Consume(ctx context.Context, userID uuid.UUID, tokens int) error {
	if q == nil || q.rdb == nil || tokens <= 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	k := key(userID)
	n, err := q.rdb.IncrBy(ctx, k, int64(tokens)).Result()
	if err != nil {
		return fmt.Errorf("quota.Consume: incr: %w", err)
	}
	// Only set TTL on first increment (n == tokens) to avoid
	// resetting the window midway.
	if n == int64(tokens) {
		_ = q.rdb.Expire(ctx, k, 48*time.Hour).Err()
	}
	return nil
}

// Remaining returns cap - used (or cap if no usage yet). ≤ 0 means
// over cap. Used by UI quota displays — cheap GET, safe to call on
// each render.
func (q *DailyTokenQuota) Remaining(ctx context.Context, userID uuid.UUID) int {
	if q == nil || q.rdb == nil || q.cap <= 0 {
		return 0
	}
	ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
	defer cancel()
	n, err := q.rdb.Get(ctx, key(userID)).Int()
	if err != nil {
		return q.cap
	}
	return q.cap - n
}

// key uses UTC date to match Redis TTL rollover behaviour. Alt was
// using local time, but Redis itself is UTC — cheaper to align.
func key(userID uuid.UUID) string {
	return "quota:tokens:" + userID.String() + ":" + time.Now().UTC().Format("2006-01-02")
}
