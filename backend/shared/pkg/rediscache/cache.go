// Package rediscache — generic Redis-backed TTL cache with JSON
// serialization. Drop-in замена для shared/pkg/ttlcache когда нужен
// cross-instance consistency (multi-replica deploy).
//
// Use cases:
//   - Hot read endpoint with bursty identical queries (refresh tab,
//     polling, double-click) и multi-instance deploy где in-memory
//     stale между replicas был бы проблемой.
//   - JSON-serialisable payloads. Heavy / large blobs — лучше pick другой
//     storage; JSON encoding на каждый Set/Get добавляет latency.
//
// Design notes:
//   - Generic over T для type safety на boundary. T MUST be JSON-marshallable.
//   - Все методы принимают ctx — caller контролирует timeout/cancellation.
//   - Ошибки Redis — fail-soft: Get возвращает (zero, false), Set/Delete
//     возвращают error для caller'а (caller обычно warn-логирует и идёт дальше).
//   - DeletePattern — SCAN+DEL для per-prefix invalidation. Не использует
//     KEYS (O(n) blocking) — SCAN cursor-based.
//
// Schema convention: `{prefix}:{key}` (caller хардкодит prefix в key).
// Не вводим версионирование на уровне пакета — caller решает.
package rediscache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/shared/pkg/metrics"

	"github.com/redis/go-redis/v9"
)

// Cache[T] — generic Redis-backed TTL cache.
//
// Module label попадает в metrics (CacheSetErrorsTotal{module=...}) — caller
// должен передавать стабильную строку ("intelligence_insights",
// "hone_tasks") при New().
type Cache[T any] struct {
	rdb    *redis.Client
	ttl    time.Duration
	module string
}

// New constructs a Cache for type T.
//   - rdb: Redis client (panic on nil — early-fail в bootstrap'е).
//   - ttl: default TTL для Set без override'а. Must be > 0.
//   - module: stable label для prometheus метрик.
func New[T any](rdb *redis.Client, ttl time.Duration, module string) *Cache[T] {
	if rdb == nil {
		panic("rediscache.New: redis client is required")
	}
	if ttl <= 0 {
		panic("rediscache.New: ttl must be positive")
	}
	return &Cache[T]{rdb: rdb, ttl: ttl, module: module}
}

// Get returns cached value + true если есть и parse'ится. Cache miss или
// любая Redis-ошибка → (zero, false). Ошибки SREDIS не propagate'аются —
// caller просто получит cache miss и сделает direct fetch (fail-soft).
func (c *Cache[T]) Get(ctx context.Context, key string) (T, bool) {
	var zero T
	if c == nil {
		return zero, false
	}
	raw, err := c.rdb.Get(ctx, key).Result()
	if err != nil {
		// redis.Nil — обычный miss. Любая другая — fail-soft.
		return zero, false
	}
	var v T
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		// Corrupt entry — opportunistic delete + miss.
		_ = c.rdb.Del(ctx, key).Err()
		return zero, false
	}
	return v, true
}

// Set записывает value под key с default TTL. JSON marshal failure
// возвращается caller'у (programmer error — type T не serialisable);
// Redis SET error инкрементит метрику и тоже возвращается.
func (c *Cache[T]) Set(ctx context.Context, key string, val T) error {
	if c == nil {
		return nil
	}
	raw, err := json.Marshal(val)
	if err != nil {
		return fmt.Errorf("rediscache.Set: marshal: %w", err)
	}
	if err := c.rdb.Set(ctx, key, raw, c.ttl).Err(); err != nil {
		metrics.CacheSetErrorsTotal.WithLabelValues(c.module).Inc()
		return fmt.Errorf("rediscache.Set: redis: %w", err)
	}
	return nil
}

// Delete removes key. Идемпотентен (отсутствие key — не ошибка).
func (c *Cache[T]) Delete(ctx context.Context, key string) error {
	if c == nil {
		return nil
	}
	if err := c.rdb.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("rediscache.Delete: %w", err)
	}
	return nil
}

// DeletePattern удаляет все keys matching glob pattern. Использует SCAN
// для безопасного traversal (KEYS блокирует Redis на больших keyspace'ах).
//
// Pattern syntax — glob по spec'у Redis: `prefix:*`, `users:?:*`, etc.
// Be careful с unbounded patterns на production'е — call this только когда
// keyspace bounded (per-user invalidate).
func (c *Cache[T]) DeletePattern(ctx context.Context, pattern string) error {
	if c == nil || pattern == "" {
		return nil
	}
	var (
		cursor uint64
		batch  []string
		total  int
	)
	for {
		keys, next, err := c.rdb.Scan(ctx, cursor, pattern, 256).Result()
		if err != nil && !errors.Is(err, redis.Nil) {
			return fmt.Errorf("rediscache.DeletePattern: scan: %w", err)
		}
		batch = append(batch[:0], keys...)
		if len(batch) > 0 {
			if err := c.rdb.Del(ctx, batch...).Err(); err != nil {
				return fmt.Errorf("rediscache.DeletePattern: del: %w", err)
			}
			total += len(batch)
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return nil
}
