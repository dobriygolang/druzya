// cache.go — Redis-backed read-through caches for mock_interview.
//
// We keep the wrapper thin: read calls hit Redis first (60s TTL on the
// leaderboard payload), miss falls through to the canonical Postgres
// repo. There's no write path here — the leaderboard is fully derived
// from `mock_pipelines`, so cache invalidation happens implicitly by
// TTL. That's good enough for a read-mostly aggregate.
//
// Why a Redis cache at all: the leaderboard query joins users +
// aggregates across all (sub)company rows (see postgres_leaderboard.go).
// On the 12-GB VPS even a single sequential scan during peak hours
// stalls the connection pool — 60s TTL drops the read load by ~99%.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// DefaultLeaderboardTTL — caps the leaderboard staleness. 60s feels right
// for a "live" UI: long enough to absorb a burst of finishes (matchmaker
// + judge cycles complete in ~30s each) without making the page feel
// stale to the user who just placed.
const DefaultLeaderboardTTL = 60 * time.Second

// KV is the slim subset of go-redis we use here. Lets tests inject an
// in-memory map without dragging miniredis in.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// ErrCacheMiss is the typed miss sentinel — same shape as ai_mock cache.
var ErrCacheMiss = errors.New("mock_interview.cache: miss")

type redisKV struct{ rdb *redis.Client }

// NewRedisKV wraps a *redis.Client into the narrow KV used by the cache
// wrappers. Returns nil-safe ops when rdb is nil — callers can still
// instantiate the cache and it'll degrade to "always miss" cleanly.
func NewRedisKV(rdb *redis.Client) KV { return redisKV{rdb: rdb} }

func (r redisKV) Get(ctx context.Context, key string) (string, error) {
	if r.rdb == nil {
		return "", ErrCacheMiss
	}
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("mock_interview.cache.Get: %w", err)
	}
	return v, nil
}

func (r redisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if r.rdb == nil {
		return nil
	}
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("mock_interview.cache.Set: %w", err)
	}
	return nil
}

func (r redisKV) Del(ctx context.Context, keys ...string) error {
	if r.rdb == nil {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("mock_interview.cache.Del: %w", err)
	}
	return nil
}

// CachedLeaderboardRepo wraps a delegate LeaderboardRepo with a 60s TTL
// Redis cache. The wrapper is itself a domain.LeaderboardRepo so
// bootstrap can drop it in transparently.
type CachedLeaderboardRepo struct {
	delegate domain.LeaderboardRepo
	kv       KV
	ttl      time.Duration
	log      *slog.Logger
}

// NewCachedLeaderboardRepo wires the wrapper. ttl<=0 falls back to
// DefaultLeaderboardTTL. log may be nil (silent).
func NewCachedLeaderboardRepo(delegate domain.LeaderboardRepo, kv KV, ttl time.Duration, log *slog.Logger) *CachedLeaderboardRepo {
	if ttl <= 0 {
		ttl = DefaultLeaderboardTTL
	}
	return &CachedLeaderboardRepo{delegate: delegate, kv: kv, ttl: ttl, log: log}
}

// keyLeaderboard builds the per-(scope, limit) cache key. Bumping the
// version prefix here is the global invalidation knob if/when the
// payload shape changes.
func (c *CachedLeaderboardRepo) keyLeaderboard(companyID *uuid.UUID, limit int) string {
	scope := "global"
	if companyID != nil && *companyID != uuid.Nil {
		scope = companyID.String()
	}
	return fmt.Sprintf("mock_interview:v1:leaderboard:%s:%d", scope, limit)
}

// Top reads the cache, falls back to the delegate on miss, writes the
// cache. Failures on the cache path NEVER block the delegate read — we
// just log and continue. Anti-fallback: a delegate error always
// surfaces as a real error to the caller (no fake-empty list).
func (c *CachedLeaderboardRepo) Top(ctx context.Context, companyID *uuid.UUID, limit int) ([]domain.LeaderboardEntry, error) {
	key := c.keyLeaderboard(companyID, limit)
	if c.kv != nil {
		raw, err := c.kv.Get(ctx, key)
		if err == nil {
			var out []domain.LeaderboardEntry
			if uerr := json.Unmarshal([]byte(raw), &out); uerr == nil {
				return out, nil
			}
			if c.log != nil {
				c.log.WarnContext(ctx, "mock_interview.cache: corrupt leaderboard entry, refreshing", slog.String("key", key))
			}
		} else if !errors.Is(err, ErrCacheMiss) && c.log != nil {
			c.log.WarnContext(ctx, "mock_interview.cache: leaderboard get failed", slog.Any("err", err))
		}
	}
	rows, err := c.delegate.Top(ctx, companyID, limit)
	if err != nil {
		return nil, err
	}
	if c.kv != nil {
		blob, merr := json.Marshal(rows)
		if merr == nil {
			if serr := c.kv.Set(ctx, key, blob, c.ttl); serr != nil && c.log != nil {
				c.log.WarnContext(ctx, "mock_interview.cache: leaderboard set failed", slog.Any("err", serr))
			}
		}
	}
	return rows, nil
}

var _ domain.LeaderboardRepo = (*CachedLeaderboardRepo)(nil)
