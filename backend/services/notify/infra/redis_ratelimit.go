package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/notify/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// PerUserLimit is the maximum Telegram messages per user per minute.
// Bible §3.11 "rate limits to avoid flooding".
const PerUserLimit = 3

// RedisRateLimiter implements domain.RateLimiter using a sliding minute bucket.
// Key: ratelimit:tg:{user_id} → INT count, TTL 60 seconds.
type RedisRateLimiter struct {
	rdb    *redis.Client
	limit  int
	window time.Duration
}

// NewRedisRateLimiter builds a limiter with sane defaults.
func NewRedisRateLimiter(rdb *redis.Client) *RedisRateLimiter {
	return &RedisRateLimiter{rdb: rdb, limit: PerUserLimit, window: time.Minute}
}

// Allow atomically INCRs the counter and sets a TTL on first use. If the
// counter exceeds the limit, it returns (false, remaining TTL).
func (r *RedisRateLimiter) Allow(ctx context.Context, userID uuid.UUID) (bool, time.Duration, error) {
	key := fmt.Sprintf("ratelimit:tg:%s", userID.String())
	pipe := r.rdb.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, r.window)
	ttl := pipe.TTL(ctx, key)
	if _, err := pipe.Exec(ctx); err != nil {
		return false, 0, fmt.Errorf("notify.ratelimit: %w", err)
	}
	count := incr.Val()
	if count <= int64(r.limit) {
		return true, 0, nil
	}
	d := ttl.Val()
	if d < 0 {
		d = r.window
	}
	return false, d, nil
}

// Compile-time assertion.
var _ domain.RateLimiter = (*RedisRateLimiter)(nil)
