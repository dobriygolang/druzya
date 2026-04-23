// cache.go — read-through кеш для FriendRepo.ListAccepted (горячая страница).
//
// TTL 60s; write-методы (Add/Accept/Remove/Block/Unblock) явно бьют ключ
// для обоих участников.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/friends/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// DefaultListTTL для friend list.
const DefaultListTTL = 60 * time.Second

// CacheKeyVersion — bump для shape-миграции.
const CacheKeyVersion = "v1"

// KV — узкий интерфейс Redis.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// ErrCacheMiss возвращается KV.Get при miss.
var ErrCacheMiss = errors.New("friends.cache: miss")

type redisKV struct{ rdb *redis.Client }

// NewRedisKV адаптер.
func NewRedisKV(rdb *redis.Client) KV { return redisKV{rdb: rdb} }

func (r redisKV) Get(ctx context.Context, key string) (string, error) {
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("friends.cache.redisKV.Get: %w", err)
	}
	return v, nil
}

func (r redisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("friends.cache.redisKV.Set: %w", err)
	}
	return nil
}

func (r redisKV) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("friends.cache.redisKV.Del: %w", err)
	}
	return nil
}

// CachedRepo wrapper над FriendRepo.
type CachedRepo struct {
	delegate domain.FriendRepo
	kv       KV
	ttl      time.Duration
	log      *slog.Logger
	sf       singleflight.Group
}

// NewCachedRepo конструктор.
func NewCachedRepo(d domain.FriendRepo, kv KV, ttl time.Duration, log *slog.Logger) *CachedRepo {
	if ttl <= 0 {
		ttl = DefaultListTTL
	}
	if log == nil {
		log = slog.New(slog.NewTextHandler(discardWriter{}, nil))
	}
	return &CachedRepo{delegate: d, kv: kv, ttl: ttl, log: log}
}

func keyAccepted(uid uuid.UUID) string {
	return fmt.Sprintf("friends:%s:accepted:%s", CacheKeyVersion, uid.String())
}

// ListAccepted — read-through.
func (c *CachedRepo) ListAccepted(ctx context.Context, uid uuid.UUID) ([]domain.FriendListEntry, error) {
	key := keyAccepted(uid)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var out []domain.FriendListEntry
		if jerr := json.Unmarshal([]byte(raw), &out); jerr == nil {
			return out, nil
		}
		c.log.Warn("friends.cache: corrupt entry, refreshing", slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("friends.cache: redis Get failed, fallback", slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.ListAccepted(ctx, uid)
	})
	if err != nil {
		return nil, fmt.Errorf("friends.cache.ListAccepted: %w", err)
	}
	out, ok := v.([]domain.FriendListEntry)
	if !ok {
		return nil, fmt.Errorf("friends.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(out); jerr == nil {
		_ = c.kv.Set(ctx, key, data, c.ttl)
	}
	return out, nil
}

// Pass-throughs с invalidation.
func (c *CachedRepo) Add(ctx context.Context, requester, addressee uuid.UUID) (domain.Friendship, error) {
	f, err := c.delegate.Add(ctx, requester, addressee)
	c.invalidatePair(ctx, requester, addressee)
	if err != nil {
		return f, fmt.Errorf("friends.cache.Add: %w", err)
	}
	return f, nil
}
func (c *CachedRepo) Accept(ctx context.Context, id int64, byUser uuid.UUID) (domain.Friendship, error) {
	f, err := c.delegate.Accept(ctx, id, byUser)
	if err == nil {
		c.invalidatePair(ctx, f.RequesterID, f.AddresseeID)
		return f, nil
	}
	return f, fmt.Errorf("friends.cache.Accept: %w", err)
}
func (c *CachedRepo) Decline(ctx context.Context, id int64, byUser uuid.UUID) error {
	err := c.delegate.Decline(ctx, id, byUser)
	c.invalidate(ctx, byUser)
	if err != nil {
		return fmt.Errorf("friends.cache.Decline: %w", err)
	}
	return nil
}
func (c *CachedRepo) Block(ctx context.Context, byUser, target uuid.UUID) error {
	err := c.delegate.Block(ctx, byUser, target)
	c.invalidatePair(ctx, byUser, target)
	if err != nil {
		return fmt.Errorf("friends.cache.Block: %w", err)
	}
	return nil
}
func (c *CachedRepo) Unblock(ctx context.Context, byUser, target uuid.UUID) error {
	err := c.delegate.Unblock(ctx, byUser, target)
	c.invalidate(ctx, byUser)
	if err != nil {
		return fmt.Errorf("friends.cache.Unblock: %w", err)
	}
	return nil
}
func (c *CachedRepo) Remove(ctx context.Context, byUser, friend uuid.UUID) error {
	err := c.delegate.Remove(ctx, byUser, friend)
	c.invalidatePair(ctx, byUser, friend)
	if err != nil {
		return fmt.Errorf("friends.cache.Remove: %w", err)
	}
	return nil
}
func (c *CachedRepo) ListIncoming(ctx context.Context, uid uuid.UUID) ([]domain.FriendListEntry, error) {
	rows, err := c.delegate.ListIncoming(ctx, uid)
	if err != nil {
		return rows, fmt.Errorf("friends.cache.ListIncoming: %w", err)
	}
	return rows, nil
}
func (c *CachedRepo) ListOutgoing(ctx context.Context, uid uuid.UUID) ([]domain.FriendListEntry, error) {
	rows, err := c.delegate.ListOutgoing(ctx, uid)
	if err != nil {
		return rows, fmt.Errorf("friends.cache.ListOutgoing: %w", err)
	}
	return rows, nil
}
func (c *CachedRepo) ListBlocked(ctx context.Context, uid uuid.UUID) ([]domain.FriendListEntry, error) {
	rows, err := c.delegate.ListBlocked(ctx, uid)
	if err != nil {
		return rows, fmt.Errorf("friends.cache.ListBlocked: %w", err)
	}
	return rows, nil
}
func (c *CachedRepo) GetIDByPair(ctx context.Context, a, b uuid.UUID) (int64, error) {
	id, err := c.delegate.GetIDByPair(ctx, a, b)
	if err != nil {
		return id, fmt.Errorf("friends.cache.GetIDByPair: %w", err)
	}
	return id, nil
}
func (c *CachedRepo) Suggestions(ctx context.Context, uid uuid.UUID, limit int) ([]domain.FriendListEntry, error) {
	rows, err := c.delegate.Suggestions(ctx, uid, limit)
	if err != nil {
		return rows, fmt.Errorf("friends.cache.Suggestions: %w", err)
	}
	return rows, nil
}

func (c *CachedRepo) invalidate(ctx context.Context, uid uuid.UUID) {
	_ = c.kv.Del(ctx, keyAccepted(uid))
}
func (c *CachedRepo) invalidatePair(ctx context.Context, a, b uuid.UUID) {
	_ = c.kv.Del(ctx, keyAccepted(a), keyAccepted(b))
}

type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }

var _ domain.FriendRepo = (*CachedRepo)(nil)
