package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/ai_mock/domain"

	"github.com/redis/go-redis/v9"
)

// RedisLimiter implements domain.RateLimiter using a fixed-window counter.
// Bible requires 10 msg/min per session on the /message endpoint.
type RedisLimiter struct {
	rdb *redis.Client
}

// NewRedisLimiter wraps a client.
func NewRedisLimiter(rdb *redis.Client) *RedisLimiter { return &RedisLimiter{rdb: rdb} }

// Allow returns (allowed, retryAfterSec, err). The first call in a window
// primes the TTL; every subsequent call only increments.
func (l *RedisLimiter) Allow(ctx context.Context, key string, limit int, windowSec int) (bool, int, error) {
	if l.rdb == nil {
		// No-op when Redis is unavailable; tests that don't need the limiter can
		// skip wiring one. Production boot must wire a real client.
		return true, 0, nil
	}
	k := "mock:ratelimit:" + key
	// INCR + EXPIRE-if-new-window pattern.
	n, err := l.rdb.Incr(ctx, k).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return true, 0, nil
		}
		return false, 0, fmt.Errorf("mock.RedisLimiter.Allow: incr: %w", err)
	}
	if n == 1 {
		// First hit — seal the window.
		if err := l.rdb.Expire(ctx, k, time.Duration(windowSec)*time.Second).Err(); err != nil {
			return false, 0, fmt.Errorf("mock.RedisLimiter.Allow: expire: %w", err)
		}
	}
	if int(n) > limit {
		ttl, _ := l.rdb.TTL(ctx, k).Result()
		retry := int(ttl.Seconds())
		if retry < 1 {
			retry = 1
		}
		return false, retry, nil
	}
	return true, 0, nil
}

// Interface guard.
var _ domain.RateLimiter = (*RedisLimiter)(nil)
