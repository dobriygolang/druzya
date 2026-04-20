package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/rating/domain"
	"druz9/shared/enums"

	"github.com/redis/go-redis/v9"
)

// RedisLeaderboard caches leaderboard entries per section. We keep it simple:
// the full JSON-encoded slice is cached under `rating:{section}:leaderboard:{limit}`
// with the configured TTL. On cache hit we deserialise and return.
//
// STUB: a future refactor could use a Redis Sorted Set (ZADD elo user_id) plus
// a small hash of usernames to rebuild rows incrementally. Current impl is the
// simplest thing that passes bible §3.6 "TTL 1 min".
type RedisLeaderboard struct {
	rdb *redis.Client
}

// NewRedisLeaderboard wires a cache adapter.
func NewRedisLeaderboard(rdb *redis.Client) *RedisLeaderboard {
	return &RedisLeaderboard{rdb: rdb}
}

// Get returns cached entries or (nil,false) on miss.
func (c *RedisLeaderboard) Get(ctx context.Context, section enums.Section, limit int) ([]domain.LeaderboardEntry, bool, error) {
	key := fmt.Sprintf("rating:%s:leaderboard:%d", section, limit)
	raw, err := c.rdb.Get(ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("rating.redis.Get: %w", err)
	}
	var out []domain.LeaderboardEntry
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, false, fmt.Errorf("rating.redis.Get: unmarshal: %w", err)
	}
	return out, true, nil
}

// Put caches entries under the (section,limit) key with ttl.
func (c *RedisLeaderboard) Put(ctx context.Context, section enums.Section, entries []domain.LeaderboardEntry, ttl time.Duration) error {
	// Key is shared across limit variants — we key on limit=len(entries) for
	// simplicity; callers asking for a smaller limit will still get a fresh PG
	// hit until this entry expires.
	key := fmt.Sprintf("rating:%s:leaderboard:%d", section, len(entries))
	raw, err := json.Marshal(entries)
	if err != nil {
		return fmt.Errorf("rating.redis.Put: marshal: %w", err)
	}
	if err := c.rdb.Set(ctx, key, raw, ttl).Err(); err != nil {
		return fmt.Errorf("rating.redis.Put: %w", err)
	}
	return nil
}

// Compile-time assertion.
var _ domain.LeaderboardCache = (*RedisLeaderboard)(nil)
