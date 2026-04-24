// Package ratelimit содержит общую Redis-реализацию fixed-window rate-limiter,
// которую разделяют auth и copilot (а дальше — кто угодно). Оба сервиса раньше
// тащили свою копию ровно одного и того же INCR+EXPIRE+TTL цикла.
//
// Пакет намеренно НЕ определяет доменных ошибок (тип ErrRateLimited) —
// каждый вызывающий сервис оборачивает результат в свою доменную ошибку
// на границе infra -> domain, чтобы не протекала межсервисная зависимость.
package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Result описывает итог одного вызова Allow.
//
// Allowed=true означает, что счётчик ещё не вышел за лимит (инкремент
// всё равно произведён — это инвариант fixed-window). Remaining — сколько
// вызовов осталось в текущем окне. RetryAfterSec выставляется только при
// Allowed=false и содержит оставшийся TTL окна в секундах.
type Result struct {
	Allowed       bool
	Remaining     int
	RetryAfterSec int
}

// RedisFixedWindow — счётчик с фиксированным окном поверх Redis. Один
// экземпляр можно переиспользовать между endpoint'ами: окно и ключ
// передаются в Allow().
type RedisFixedWindow struct {
	rdb *redis.Client
}

// NewRedisFixedWindow конструирует лимитер над общим Redis-клиентом.
func NewRedisFixedWindow(rdb *redis.Client) *RedisFixedWindow {
	return &RedisFixedWindow{rdb: rdb}
}

// Allow инкрементирует счётчик key и возвращает Result. На первом попадании
// окна вешает TTL=window — без этого ключ жил бы вечно. На превышении
// лимита читает фактический TTL и кладёт его в RetryAfterSec.
//
// Ошибки Redis возвращаются как err — поведение на эту тему определяет
// вызывающий сервис (fail-closed vs fail-open).
func (r *RedisFixedWindow) Allow(ctx context.Context, key string, limit int, window time.Duration) (Result, error) {
	n, err := r.rdb.Incr(ctx, key).Result()
	if err != nil {
		return Result{}, fmt.Errorf("ratelimit.RedisFixedWindow.Allow: incr: %w", err)
	}
	if n == 1 {
		// Первый инкремент окна — привязываем TTL.
		if err := r.rdb.Expire(ctx, key, window).Err(); err != nil {
			return Result{}, fmt.Errorf("ratelimit.RedisFixedWindow.Allow: expire: %w", err)
		}
	}
	if int(n) > limit {
		ttl, err := r.rdb.TTL(ctx, key).Result()
		if err != nil || ttl < 0 {
			ttl = window
		}
		return Result{Allowed: false, Remaining: 0, RetryAfterSec: int(ttl.Seconds())}, nil
	}
	return Result{Allowed: true, Remaining: limit - int(n)}, nil
}
