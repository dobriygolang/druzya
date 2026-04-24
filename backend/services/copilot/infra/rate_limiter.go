package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/copilot/domain"
	sharedratelimit "druz9/shared/pkg/ratelimit"

	"github.com/redis/go-redis/v9"
)

// RedisRateLimiter — тонкая обёртка над sharedratelimit.RedisFixedWindow,
// возвращающая copilot-доменную ErrRateLimited при превышении квоты.
// Раньше здесь жила ручная копия того же INCR+EXPIRE+TTL цикла, что и в
// auth/infra/redis.go; теперь обе реализации делят shared-пакет.
type RedisRateLimiter struct {
	inner *sharedratelimit.RedisFixedWindow
}

// NewRedisRateLimiter строит limiter над общим клиентом.
func NewRedisRateLimiter(rdb *redis.Client) *RedisRateLimiter {
	return &RedisRateLimiter{inner: sharedratelimit.NewRedisFixedWindow(rdb)}
}

// Allow инкрементирует счётчик и возвращает (remaining, retryAfterSec, err).
// При превышении лимита оборачивает domain.ErrRateLimited.
func (r *RedisRateLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (int, int, error) {
	res, err := r.inner.Allow(ctx, key, limit, window)
	if err != nil {
		return 0, 0, fmt.Errorf("copilot.RedisRateLimiter.Allow: %w", err)
	}
	if !res.Allowed {
		return 0, res.RetryAfterSec, fmt.Errorf("copilot.RedisRateLimiter.Allow: %w", domain.ErrRateLimited)
	}
	return res.Remaining, 0, nil
}
