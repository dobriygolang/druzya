// cache.go — read-through Redis-кеш для UserAchievementRepo.List.
//
// Шаблон копирует profile/infra/cache.go: тонкий KV-интерфейс, singleflight,
// anti-fallback policy (Redis Get errors propagate, Set errors emit
// cache_set_errors_total), explicit Invalidate на write-путях.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/achievements/domain"
	"druz9/shared/pkg/metrics"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// DefaultListTTL — TTL для key 'achievements:v1:list:<uid>'. 5 минут балансирует
// свежесть и нагрузку: write-пути (UpsertProgress/Unlock) явно бьют ключ,
// поэтому несвежесть встретится только если ачивка зависит от внешнего
// агрегата (XP per-second), что у нас отсутствует.
const DefaultListTTL = 5 * time.Minute

// CacheKeyVersion — bump для миграции shape'а кеша.
const CacheKeyVersion = "v1"

// KV — узкая Redis-обёртка. *redis.Client → NewRedisKV; tests → in-memory.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// ErrCacheMiss возвращается KV.Get когда ключа нет.
var ErrCacheMiss = errors.New("achievements.cache: miss")

type redisKV struct{ rdb *redis.Client }

// NewRedisKV адаптер.
func NewRedisKV(rdb *redis.Client) KV { return redisKV{rdb: rdb} }

func (r redisKV) Get(ctx context.Context, key string) (string, error) {
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("achievements.cache.redisKV.Get: %w", err)
	}
	return v, nil
}

func (r redisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("achievements.cache.redisKV.Set: %w", err)
	}
	return nil
}

func (r redisKV) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("achievements.cache.redisKV.Del: %w", err)
	}
	return nil
}

// CachedRepo — read-through wrapper. Реализует domain.UserAchievementRepo.
type CachedRepo struct {
	delegate domain.UserAchievementRepo
	kv       KV
	ttl      time.Duration
	log      *slog.Logger
	sf       singleflight.Group
}

// NewCachedRepo конструирует cached-обёртку. log обязателен (anti-fallback policy).
func NewCachedRepo(d domain.UserAchievementRepo, kv KV, ttl time.Duration, log *slog.Logger) *CachedRepo {
	if ttl <= 0 {
		ttl = DefaultListTTL
	}
	if log == nil {
		panic("achievements.infra.NewCachedRepo: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &CachedRepo{delegate: d, kv: kv, ttl: ttl, log: log}
}

func keyList(uid uuid.UUID) string {
	return fmt.Sprintf("achievements:%s:list:%s", CacheKeyVersion, uid.String())
}

// Get — pass-through, единичный read не stuff в кеш.
func (c *CachedRepo) Get(ctx context.Context, uid uuid.UUID, code string) (domain.UserAchievement, error) {
	r, err := c.delegate.Get(ctx, uid, code)
	if err != nil {
		return r, fmt.Errorf("achievements.cache.Get: %w", err)
	}
	return r, nil
}

// List — read-through с singleflight.
func (c *CachedRepo) List(ctx context.Context, uid uuid.UUID) ([]domain.UserAchievement, error) {
	key := keyList(uid)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var out []domain.UserAchievement
		if jerr := json.Unmarshal([]byte(raw), &out); jerr == nil {
			return out, nil
		}
		c.log.Warn("achievements.cache: corrupt list entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		// Anti-fallback: real Redis failure propagates.
		return nil, fmt.Errorf("achievements.cache.List: redis: %w", err)
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.List(ctx, uid)
	})
	if err != nil {
		return nil, fmt.Errorf("achievements.cache.List: %w", err)
	}
	out, ok := v.([]domain.UserAchievement)
	if !ok {
		return nil, fmt.Errorf("achievements.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(out); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.ttl); serr != nil {
			metrics.CacheSetErrorsTotal.WithLabelValues("achievements").Inc()
			c.log.Warn("achievements.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return out, nil
}

// UpsertProgress — pass-through + invalidate.
func (c *CachedRepo) UpsertProgress(ctx context.Context, uid uuid.UUID, code string, progress int, target int) (domain.UserAchievement, bool, error) {
	r, unlocked, err := c.delegate.UpsertProgress(ctx, uid, code, progress, target)
	c.invalidate(ctx, uid)
	if err != nil {
		return r, unlocked, fmt.Errorf("achievements.cache.UpsertProgress: %w", err)
	}
	return r, unlocked, nil
}

// Unlock — pass-through + invalidate.
func (c *CachedRepo) Unlock(ctx context.Context, uid uuid.UUID, code string, target int) (domain.UserAchievement, bool, error) {
	r, unlocked, err := c.delegate.Unlock(ctx, uid, code, target)
	c.invalidate(ctx, uid)
	if err != nil {
		return r, unlocked, fmt.Errorf("achievements.cache.Unlock: %w", err)
	}
	return r, unlocked, nil
}

func (c *CachedRepo) invalidate(ctx context.Context, uid uuid.UUID) {
	if err := c.kv.Del(ctx, keyList(uid)); err != nil {
		c.log.Warn("achievements.cache: redis Del failed",
			slog.Any("user_id", uid), slog.Any("err", err))
	}
}

var _ domain.UserAchievementRepo = (*CachedRepo)(nil)
