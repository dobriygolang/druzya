// Package infra: cache.go contains a Redis-backed read-through cache for
// the per-user "my ratings" list. It complements the existing leaderboard
// cache (redis.go) — the leaderboard is keyed by (section, limit) and is
// repopulated by the background worker, whereas my-ratings is keyed by
// user_id and is read-through with explicit invalidation when a write
// event (match completed / kata graded) bumps the rating.
//
// Design mirrors profile/infra/cache.go:
//
//   - Tiny KV interface (Get/Set/Del) so tests inject an in-memory fake
//     without needing miniredis;
//   - singleflight collapses concurrent misses against the same uid into
//     one upstream call (thundering-herd protection);
//   - Redis errors NEVER fail the request — they are logged and we fall
//     back to the upstream Postgres repo;
//   - Bump operations forward to the delegate and then Invalidate(uid),
//     keeping write-path freshness sub-second.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/rating/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// DefaultMyRatingsTTL is the per-key TTL applied to the my-ratings cache.
// 60s matches Phase 1 (profile) and the bible's recommendation for read-
// mostly user-scoped projections.
const DefaultMyRatingsTTL = 60 * time.Second

// CacheKeyVersion is the prefix bump used when the cached JSON shape
// changes. Bump together with breaking changes to domain.SectionRating.
const CacheKeyVersion = "v1"

// KV is the minimal Redis subset used by CachedRepo. *redis.Client
// satisfies it via the redisKV adapter; tests provide an in-memory map.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// ErrCacheMiss is the sentinel returned by KV.Get when the key is absent.
var ErrCacheMiss = errors.New("rating.cache: miss")

// redisKV adapts *redis.Client to KV.
type redisKV struct{ rdb *redis.Client }

// NewRedisKV exposes the adapter so wiring code can construct a CachedRepo
// without leaking the redisKV type.
func NewRedisKV(rdb *redis.Client) KV { return redisKV{rdb: rdb} }

func (r redisKV) Get(ctx context.Context, key string) (string, error) {
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("rating.cache.redisKV.Get: %w", err)
	}
	return v, nil
}

func (r redisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("rating.cache.redisKV.Set: %w", err)
	}
	return nil
}

func (r redisKV) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("rating.cache.redisKV.Del: %w", err)
	}
	return nil
}

// keyMy returns the Redis key for a user's my-ratings list.
func keyMy(uid uuid.UUID) string {
	return fmt.Sprintf("rating:%s:my:%s", CacheKeyVersion, uid.String())
}

// CachedRepo wraps a delegate domain.RatingRepo with read-through caching
// of the per-user `List` projection. Other methods pass through; writes
// invalidate the corresponding user key.
type CachedRepo struct {
	delegate domain.RatingRepo
	kv       KV
	ttl      time.Duration
	log      *slog.Logger
	sf       singleflight.Group
}

// Compile-time assertion — CachedRepo satisfies the same interface as
// the Postgres repo.
var _ domain.RatingRepo = (*CachedRepo)(nil)

// NewCachedRepo wraps delegate with Redis caching.
//
// If log is nil, a discard logger is used so the struct is safe in tests
// without plumbing a slog.Handler. If ttl <= 0, DefaultMyRatingsTTL is used.
func NewCachedRepo(delegate domain.RatingRepo, kv KV, ttl time.Duration, log *slog.Logger) *CachedRepo {
	if ttl <= 0 {
		ttl = DefaultMyRatingsTTL
	}
	if log == nil {
		log = slog.New(slog.NewTextHandler(discardWriter{}, nil))
	}
	return &CachedRepo{delegate: delegate, kv: kv, ttl: ttl, log: log}
}

// List is the cached path. Read-through with singleflight collapsing.
func (c *CachedRepo) List(ctx context.Context, userID uuid.UUID) ([]domain.SectionRating, error) {
	key := keyMy(userID)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var out []domain.SectionRating
		if jerr := json.Unmarshal([]byte(raw), &out); jerr == nil {
			return out, nil
		}
		c.log.Warn("rating.cache: corrupt my entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("rating.cache: redis Get failed, falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.List(ctx, userID)
	})
	if err != nil {
		return nil, fmt.Errorf("rating.cache.List: %w", err)
	}
	out, ok := v.([]domain.SectionRating)
	if !ok {
		return nil, fmt.Errorf("rating.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(out); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.ttl); serr != nil {
			c.log.Warn("rating.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return out, nil
}

// Upsert forwards to the delegate then busts the user key. This is the
// canonical write-path hook called by the rating event handlers.
func (c *CachedRepo) Upsert(ctx context.Context, r domain.SectionRating) error {
	if err := c.delegate.Upsert(ctx, r); err != nil {
		return fmt.Errorf("rating.cache.Upsert: %w", err)
	}
	c.Invalidate(ctx, r.UserID)
	return nil
}

// Top is uncached at this layer — the existing LeaderboardCache (redis.go)
// covers that path. Just forward.
func (c *CachedRepo) Top(ctx context.Context, section enums.Section, limit int) ([]domain.LeaderboardEntry, error) {
	out, err := c.delegate.Top(ctx, section, limit)
	if err != nil {
		return nil, fmt.Errorf("rating.cache.Top: %w", err)
	}
	return out, nil
}

// FindRank passes through.
func (c *CachedRepo) FindRank(ctx context.Context, userID uuid.UUID, section enums.Section) (int, error) {
	rank, err := c.delegate.FindRank(ctx, userID, section)
	if err != nil {
		return 0, fmt.Errorf("rating.cache.FindRank: %w", err)
	}
	return rank, nil
}

// HistoryLast12Weeks passes through.
func (c *CachedRepo) HistoryLast12Weeks(ctx context.Context, userID uuid.UUID) ([]domain.HistorySample, error) {
	out, err := c.delegate.HistoryLast12Weeks(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("rating.cache.HistoryLast12Weeks: %w", err)
	}
	return out, nil
}

// Invalidate busts the my-ratings key for the given user. Safe to call
// from any write path.
func (c *CachedRepo) Invalidate(ctx context.Context, userID uuid.UUID) {
	if err := c.kv.Del(ctx, keyMy(userID)); err != nil {
		c.log.Warn("rating.cache: redis Del failed",
			slog.Any("user_id", userID), slog.Any("err", err))
	}
}

// discardWriter swallows all bytes — default slog destination when nil.
type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }
