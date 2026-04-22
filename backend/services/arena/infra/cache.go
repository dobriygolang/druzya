// Package infra: cache.go is the Redis-backed read-through cache for the
// arena bounded context. Two hot reads benefit from caching today:
//
//   - GET /api/v1/arena/match/{matchId}  →  MatchInfoCache (60s TTL)
//   - "queue stats" displayed on /arena  →  QueueStatsCache (10s TTL)
//
// Both follow the same shape as profile/infra/cache.go: a tiny KV interface
// (Get/Set/Del), JSON marshalling, singleflight to collapse stampedes,
// Redis errors are LOGGED but NEVER fail the request — we always fall back
// to the upstream loader. Explicit Invalidate hooks let writers bust the
// cache deterministically (e.g. on match end).
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"time"

	"druz9/arena/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// CacheKeyVersion is bumped whenever the on-disk JSON shape changes. Bumping
// causes a rolling cache miss without a manual FLUSHDB.
const CacheKeyVersion = "v1"

// DefaultMatchInfoTTL is the per-key TTL applied to cached match views.
// Match metadata barely changes after start; we still cap at 60s so
// participant ELO updates after MatchCompleted are picked up promptly.
const DefaultMatchInfoTTL = 60 * time.Second

// DefaultQueueStatsTTL is the per-key TTL for the queue-stats card on the
// arena landing page. Short — the count fluctuates every tick.
const DefaultQueueStatsTTL = 10 * time.Second

// KV is the tiny subset of Redis used by the arena cache. *redis.Client
// satisfies it via the kvAdapter below; tests inject an in-memory map.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// ErrCacheMiss is the sentinel returned by KV.Get when the key is absent.
var ErrCacheMiss = errors.New("arena.cache: miss")

// kvAdapter adapts *redis.Client to the KV interface.
type kvAdapter struct{ rdb *redis.Client }

// NewRedisKV wires the production KV around a real Redis client.
func NewRedisKV(rdb *redis.Client) KV { return kvAdapter{rdb: rdb} }

func (a kvAdapter) Get(ctx context.Context, key string) (string, error) {
	v, err := a.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("arena.cache.kv.Get: %w", err)
	}
	return v, nil
}

func (a kvAdapter) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := a.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("arena.cache.kv.Set: %w", err)
	}
	return nil
}

func (a kvAdapter) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := a.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("arena.cache.kv.Del: %w", err)
	}
	return nil
}

// ── MatchInfo cache ───────────────────────────────────────────────────────

// MatchInfoSnapshot is the cache-eligible projection of a match. We only
// store immutable / slow-moving fields — code, suspicion scores, anti-cheat
// counters do NOT live here, by design (they are read-once and refresh fast).
type MatchInfoSnapshot struct {
	Match        domain.Match
	Task         *domain.TaskPublic
	Participants []domain.Participant
}

// MatchInfoLoader fetches the snapshot from the upstream (Postgres) when the
// cache misses.
type MatchInfoLoader func(ctx context.Context, matchID uuid.UUID) (MatchInfoSnapshot, error)

// MatchInfoCache wraps a loader with read-through Redis caching.
type MatchInfoCache struct {
	kv     KV
	ttl    time.Duration
	log    *slog.Logger
	loader MatchInfoLoader
	sf     singleflight.Group
}

// NewMatchInfoCache wires the cache. nil log → discard.
func NewMatchInfoCache(kv KV, ttl time.Duration, log *slog.Logger, loader MatchInfoLoader) *MatchInfoCache {
	if ttl <= 0 {
		ttl = DefaultMatchInfoTTL
	}
	if log == nil {
		log = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return &MatchInfoCache{kv: kv, ttl: ttl, log: log, loader: loader}
}

// keyMatchInfo returns the Redis key for match-info by match-id.
func keyMatchInfo(matchID uuid.UUID) string {
	return fmt.Sprintf("arena:%s:match:%s", CacheKeyVersion, matchID.String())
}

// Get returns the snapshot, dialing the upstream on miss.
func (c *MatchInfoCache) Get(ctx context.Context, matchID uuid.UUID) (MatchInfoSnapshot, error) {
	key := keyMatchInfo(matchID)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var snap MatchInfoSnapshot
		if jerr := json.Unmarshal([]byte(raw), &snap); jerr == nil {
			return snap, nil
		}
		c.log.Warn("arena.cache: corrupt match entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("arena.cache: redis Get failed, falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.loader(ctx, matchID)
	})
	if err != nil {
		return MatchInfoSnapshot{}, fmt.Errorf("arena.cache.MatchInfo.Get: %w", err)
	}
	snap, ok := v.(MatchInfoSnapshot)
	if !ok {
		return MatchInfoSnapshot{}, fmt.Errorf("arena.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(snap); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.ttl); serr != nil {
			c.log.Warn("arena.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return snap, nil
}

// Invalidate evicts the entry. Safe to call before/after a write; idempotent.
func (c *MatchInfoCache) Invalidate(ctx context.Context, matchID uuid.UUID) {
	if err := c.kv.Del(ctx, keyMatchInfo(matchID)); err != nil {
		c.log.Warn("arena.cache: redis Del failed",
			slog.String("match", matchID.String()), slog.Any("err", err))
	}
}

// ── Queue-stats cache ─────────────────────────────────────────────────────

// QueueStats is the small payload shown on /arena (count of waiting players
// per (mode, section), with a coarse ETA derived from queue depth).
type QueueStats struct {
	Mode      enums.ArenaMode `json:"mode"`
	Section   enums.Section   `json:"section"`
	Waiting   int             `json:"waiting"`
	EstWaitMs int64           `json:"est_wait_ms"`
}

// QueueStatsLoader returns fresh stats from Redis ZSET counts.
type QueueStatsLoader func(ctx context.Context, mode enums.ArenaMode, section enums.Section) (QueueStats, error)

// QueueStatsCache wraps a loader with a 10s TTL.
type QueueStatsCache struct {
	kv     KV
	ttl    time.Duration
	log    *slog.Logger
	loader QueueStatsLoader
	sf     singleflight.Group
}

// NewQueueStatsCache wires the cache.
func NewQueueStatsCache(kv KV, ttl time.Duration, log *slog.Logger, loader QueueStatsLoader) *QueueStatsCache {
	if ttl <= 0 {
		ttl = DefaultQueueStatsTTL
	}
	if log == nil {
		log = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return &QueueStatsCache{kv: kv, ttl: ttl, log: log, loader: loader}
}

// keyQueueStats returns the Redis key for queue stats by (mode, section).
func keyQueueStats(mode enums.ArenaMode, section enums.Section) string {
	return fmt.Sprintf("arena:%s:queue_stats:%s:%s", CacheKeyVersion, mode, section)
}

// Get returns the stats, dialing the upstream on miss.
func (c *QueueStatsCache) Get(ctx context.Context, mode enums.ArenaMode, section enums.Section) (QueueStats, error) {
	key := keyQueueStats(mode, section)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var s QueueStats
		if jerr := json.Unmarshal([]byte(raw), &s); jerr == nil {
			return s, nil
		}
		c.log.Warn("arena.cache: corrupt queue_stats entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("arena.cache: redis Get failed, falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.loader(ctx, mode, section)
	})
	if err != nil {
		return QueueStats{}, fmt.Errorf("arena.cache.QueueStats.Get: %w", err)
	}
	s, ok := v.(QueueStats)
	if !ok {
		return QueueStats{}, fmt.Errorf("arena.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(s); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.ttl); serr != nil {
			c.log.Warn("arena.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return s, nil
}

// Invalidate evicts a specific (mode, section) stat.
func (c *QueueStatsCache) Invalidate(ctx context.Context, mode enums.ArenaMode, section enums.Section) {
	if err := c.kv.Del(ctx, keyQueueStats(mode, section)); err != nil {
		c.log.Warn("arena.cache: redis Del failed",
			slog.String("mode", string(mode)), slog.String("section", string(section)),
			slog.Any("err", err))
	}
}
