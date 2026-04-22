// Package infra: cache.go contains a Redis-backed read-through cache for
// the StreakRepo — the hottest read in the daily bounded context (every
// /daily/* page hits GetStreak, plus the sanctum hero card).
//
// Mirrors the pattern in profile/infra/cache.go and rating/infra/cache.go:
//
//   - Tiny KV interface (Get/Set/Del) injected at construction so tests
//     don't need miniredis;
//   - singleflight collapses concurrent misses for the same uid;
//   - Redis errors NEVER fail a request — we log and fall back to upstream;
//   - Update forwards to the delegate then Invalidate(uid). The use case
//     SubmitKata calls StreakRepo.Update on success, so cache freshness is
//     sub-second on writes.
//
// Other daily repos (KataRepo, CalendarRepo, AutopsyRepo) are deliberately
// not wrapped here — KataRepo is keyed on (uid, date) which already buckets
// well, CalendarRepo is rarely-read, and AutopsyRepo is a write-mostly
// audit log. Add wrappers only when profiling shows them hot.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/daily/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// DefaultStreakTTL is the per-key TTL applied to streak cache entries.
// 60s keeps mid-flight rollovers fresh enough for the UI; the write path
// (SubmitKata) invalidates explicitly so post-submit reads are immediate.
const DefaultStreakTTL = 60 * time.Second

// CacheKeyVersion bump rolls every key on a schema change without manual
// FLUSHDB.
const CacheKeyVersion = "v1"

// KV is the minimal Redis surface used here. *redis.Client satisfies it
// via NewRedisKV; tests use an in-memory map.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// ErrCacheMiss is the sentinel returned by KV.Get when the key is absent.
var ErrCacheMiss = errors.New("daily.cache: miss")

type redisKV struct{ rdb *redis.Client }

// NewRedisKV adapts *redis.Client to KV.
func NewRedisKV(rdb *redis.Client) KV { return redisKV{rdb: rdb} }

func (r redisKV) Get(ctx context.Context, key string) (string, error) {
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("daily.cache.redisKV.Get: %w", err)
	}
	return v, nil
}

func (r redisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("daily.cache.redisKV.Set: %w", err)
	}
	return nil
}

func (r redisKV) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("daily.cache.redisKV.Del: %w", err)
	}
	return nil
}

// keyStreak is the per-user streak Redis key.
func keyStreak(uid uuid.UUID) string {
	return fmt.Sprintf("daily:%s:streak:%s", CacheKeyVersion, uid.String())
}

// CachedStreakRepo wraps a domain.StreakRepo with read-through caching.
type CachedStreakRepo struct {
	delegate domain.StreakRepo
	kv       KV
	ttl      time.Duration
	log      *slog.Logger
	sf       singleflight.Group
}

// Compile-time: satisfies domain.StreakRepo so wiring is a one-line swap.
var _ domain.StreakRepo = (*CachedStreakRepo)(nil)

// NewCachedStreakRepo wraps delegate. Defaults: TTL = DefaultStreakTTL,
// log = discard.
func NewCachedStreakRepo(delegate domain.StreakRepo, kv KV, ttl time.Duration, log *slog.Logger) *CachedStreakRepo {
	if ttl <= 0 {
		ttl = DefaultStreakTTL
	}
	if log == nil {
		log = slog.New(slog.NewTextHandler(discardWriter{}, nil))
	}
	return &CachedStreakRepo{delegate: delegate, kv: kv, ttl: ttl, log: log}
}

// Get is the cached path. Read-through with singleflight collapsing.
func (c *CachedStreakRepo) Get(ctx context.Context, userID uuid.UUID) (domain.StreakState, error) {
	key := keyStreak(userID)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var s domain.StreakState
		if jerr := json.Unmarshal([]byte(raw), &s); jerr == nil {
			return s, nil
		}
		c.log.Warn("daily.cache: corrupt streak entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("daily.cache: redis Get failed, falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.Get(ctx, userID)
	})
	if err != nil {
		return domain.StreakState{}, fmt.Errorf("daily.cache.Get: %w", err)
	}
	s, ok := v.(domain.StreakState)
	if !ok {
		return domain.StreakState{}, fmt.Errorf("daily.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(s); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.ttl); serr != nil {
			c.log.Warn("daily.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return s, nil
}

// Update forwards to the delegate then busts the user's streak key. This
// is the canonical write hook called by app.SubmitKata after grading.
func (c *CachedStreakRepo) Update(ctx context.Context, userID uuid.UUID, s domain.StreakState) error {
	if err := c.delegate.Update(ctx, userID, s); err != nil {
		return fmt.Errorf("daily.cache.Update: %w", err)
	}
	c.Invalidate(ctx, userID)
	return nil
}

// Invalidate busts the streak key for the given user.
func (c *CachedStreakRepo) Invalidate(ctx context.Context, userID uuid.UUID) {
	if err := c.kv.Del(ctx, keyStreak(userID)); err != nil {
		c.log.Warn("daily.cache: redis Del failed",
			slog.Any("user_id", userID), slog.Any("err", err))
	}
}

// discardWriter swallows all bytes — slog default sink when nil.
type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }
