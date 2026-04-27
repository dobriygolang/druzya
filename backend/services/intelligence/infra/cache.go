package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/intelligence/domain"
	"druz9/shared/pkg/metrics"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

const dailyBriefCacheKeyVersion = "v1"

// BriefKV is the minimal Redis surface used by CachedDailyBriefs.
type BriefKV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

var ErrBriefCacheMiss = errors.New("intelligence.brief_cache: miss")

type briefRedisKV struct{ rdb *redis.Client }

func NewBriefRedisKV(rdb *redis.Client) BriefKV {
	if rdb == nil {
		panic("intelligence.NewBriefRedisKV: redis client is required")
	}
	return briefRedisKV{rdb: rdb}
}

func (r briefRedisKV) Get(ctx context.Context, key string) (string, error) {
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrBriefCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("intelligence.briefRedisKV.Get: %w", err)
	}
	return v, nil
}

func (r briefRedisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("intelligence.briefRedisKV.Set: %w", err)
	}
	return nil
}

func (r briefRedisKV) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("intelligence.briefRedisKV.Del: %w", err)
	}
	return nil
}

// CachedDailyBriefs is a Redis read-through cache for the persisted daily
// brief. It does not cache prompt inputs or LLM output separately: force=true
// still bypasses GetForDate in the use case and regenerates from fresh signals.
type CachedDailyBriefs struct {
	delegate domain.DailyBriefRepo
	kv       BriefKV
	ttl      time.Duration
	log      *slog.Logger
	sf       singleflight.Group
}

var _ domain.DailyBriefRepo = (*CachedDailyBriefs)(nil)

func NewCachedDailyBriefs(delegate domain.DailyBriefRepo, kv BriefKV, ttl time.Duration, log *slog.Logger) *CachedDailyBriefs {
	if delegate == nil {
		panic("intelligence.NewCachedDailyBriefs: delegate is required")
	}
	if kv == nil {
		panic("intelligence.NewCachedDailyBriefs: kv is required")
	}
	if ttl <= 0 {
		panic("intelligence.NewCachedDailyBriefs: ttl must be positive")
	}
	if log == nil {
		panic("intelligence.NewCachedDailyBriefs: logger is required")
	}
	return &CachedDailyBriefs{delegate: delegate, kv: kv, ttl: ttl, log: log}
}

func (c *CachedDailyBriefs) GetForDate(ctx context.Context, userID uuid.UUID, date time.Time) (domain.DailyBrief, error) {
	key := keyDailyBrief(userID, date)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var b domain.DailyBrief
		if jerr := json.Unmarshal([]byte(raw), &b); jerr == nil {
			return b, nil
		}
		c.log.Warn("intelligence.brief_cache: corrupt entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrBriefCacheMiss) {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.CachedDailyBriefs.GetForDate: redis: %w", err)
	}

	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.GetForDate(ctx, userID, date)
	})
	if err != nil {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.CachedDailyBriefs.GetForDate: %w", err)
	}
	b, ok := v.(domain.DailyBrief)
	if !ok {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.CachedDailyBriefs.GetForDate: singleflight returned %T", v)
	}
	c.set(ctx, key, b)
	return b, nil
}

func (c *CachedDailyBriefs) Upsert(ctx context.Context, userID uuid.UUID, date time.Time, b domain.DailyBrief) error {
	if err := c.delegate.Upsert(ctx, userID, date, b); err != nil {
		return fmt.Errorf("intelligence.CachedDailyBriefs.Upsert: %w", err)
	}
	c.set(ctx, keyDailyBrief(userID, date), b)
	return nil
}

func (c *CachedDailyBriefs) LastForcedAt(ctx context.Context, userID uuid.UUID) (time.Time, error) {
	lastForcedAt, err := c.delegate.LastForcedAt(ctx, userID)
	if err != nil {
		return time.Time{}, fmt.Errorf("intelligence.CachedDailyBriefs.LastForcedAt: %w", err)
	}
	return lastForcedAt, nil
}

func (c *CachedDailyBriefs) set(ctx context.Context, key string, b domain.DailyBrief) {
	raw, err := json.Marshal(b)
	if err != nil {
		c.log.Warn("intelligence.brief_cache: marshal failed", slog.String("key", key), slog.Any("err", err))
		return
	}
	if err := c.kv.Set(ctx, key, raw, c.ttl); err != nil {
		metrics.CacheSetErrorsTotal.WithLabelValues("intelligence_daily_brief").Inc()
		c.log.Warn("intelligence.brief_cache: redis Set failed",
			slog.String("key", key), slog.Any("err", err))
	}
}

func keyDailyBrief(uid uuid.UUID, date time.Time) string {
	return fmt.Sprintf("intelligence:%s:daily_brief:%s:%s",
		dailyBriefCacheKeyVersion,
		uid.String(),
		date.UTC().Format("2006-01-02"),
	)
}
