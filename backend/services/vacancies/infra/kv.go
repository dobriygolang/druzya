// kv.go — tiny Redis-shaped KV interface used by the OpenRouter skill
// extractor's 7-day per-description cache.
//
// Lives separately from any larger cache wrapper now that the parsed-
// postings catalogue is fully in-memory; the only persistent KV consumer
// in this package is the LLM-extraction cache.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// KV is the minimal Get/Set/Del subset the extractor needs. Production
// wires redisKV{*redis.Client}; tests inject an in-memory map.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// ErrCacheMiss is the sentinel returned by KV.Get on absent key.
var ErrCacheMiss = errors.New("vacancies.kv: miss")

// CacheKeyVersion namespaces all KV keys so a JSON-shape change can be
// rolled out by bumping the constant rather than flushing Redis.
const CacheKeyVersion = "v2"

type redisKV struct{ rdb *redis.Client }

// NewRedisKV adapts *redis.Client to KV.
func NewRedisKV(rdb *redis.Client) KV { return redisKV{rdb: rdb} }

func (r redisKV) Get(ctx context.Context, key string) (string, error) {
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("vacancies.kv.Get: %w", err)
	}
	return v, nil
}

func (r redisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("vacancies.kv.Set: %w", err)
	}
	return nil
}

func (r redisKV) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("vacancies.kv.Del: %w", err)
	}
	return nil
}
