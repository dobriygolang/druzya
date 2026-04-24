package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/copilot/domain"

	"github.com/redis/go-redis/v9"
)

// RedisRateLimiter — фикс-windowed счётчик в Redis. Зеркалит auth-реализацию
// (не импортируем её, чтобы не создавать кросс-доменную зависимость), но
// возвращает copilot-доменный ErrRateLimited.
type RedisRateLimiter struct {
	rdb *redis.Client
}

// NewRedisRateLimiter строит limiter над общим клиентом.
func NewRedisRateLimiter(rdb *redis.Client) *RedisRateLimiter {
	return &RedisRateLimiter{rdb: rdb}
}

// Allow инкрементирует счётчик и возвращает (remaining, retryAfterSec, err).
// При превышении лимита оборачивает domain.ErrRateLimited.
func (r *RedisRateLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (int, int, error) {
	n, err := r.rdb.Incr(ctx, key).Result()
	if err != nil {
		return 0, 0, fmt.Errorf("copilot.RedisRateLimiter.Allow: incr: %w", err)
	}
	if n == 1 {
		// Первый инкремент окна — вешаем TTL. Без этого ключ бы жил вечно.
		if err := r.rdb.Expire(ctx, key, window).Err(); err != nil {
			return 0, 0, fmt.Errorf("copilot.RedisRateLimiter.Allow: expire: %w", err)
		}
	}
	if int(n) > limit {
		ttl, err := r.rdb.TTL(ctx, key).Result()
		if err != nil || ttl < 0 {
			ttl = window
		}
		return 0, int(ttl.Seconds()), fmt.Errorf("copilot.RedisRateLimiter.Allow: %w", domain.ErrRateLimited)
	}
	return limit - int(n), 0, nil
}
