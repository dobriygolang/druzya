package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/notify/domain"

	"github.com/redis/go-redis/v9"
)

// queueKey is the Redis List used as a FIFO for outbound notifications.
// Producers LPUSH, workers BRPOP (pop from the tail → oldest wins).
const queueKey = "queue:notifications"

// RedisQueue is a domain.Queue backed by a Redis List.
type RedisQueue struct {
	rdb *redis.Client
}

// NewRedisQueue constructs a RedisQueue.
func NewRedisQueue(rdb *redis.Client) *RedisQueue { return &RedisQueue{rdb: rdb} }

// Enqueue LPUSHes the JSON-encoded Notification.
func (q *RedisQueue) Enqueue(ctx context.Context, n domain.Notification) error {
	raw, err := json.Marshal(n)
	if err != nil {
		return fmt.Errorf("notify.redis.Enqueue: marshal: %w", err)
	}
	if err := q.rdb.LPush(ctx, queueKey, raw).Err(); err != nil {
		return fmt.Errorf("notify.redis.Enqueue: LPUSH: %w", err)
	}
	return nil
}

// Dequeue BRPOPs with a short-ish timeout so ctx cancellation stays responsive.
// The worker calls this in a loop.
func (q *RedisQueue) Dequeue(ctx context.Context) (domain.Notification, error) {
	// 2-second blocking read lets us honour ctx.Done without tight-looping Redis.
	res, err := q.rdb.BRPop(ctx, 2*time.Second, queueKey).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return domain.Notification{}, context.DeadlineExceeded
		}
		return domain.Notification{}, fmt.Errorf("notify.redis.Dequeue: BRPOP: %w", err)
	}
	// res == [key, payload]
	if len(res) != 2 {
		return domain.Notification{}, fmt.Errorf("notify.redis.Dequeue: unexpected BRPOP shape %d", len(res))
	}
	var n domain.Notification
	if err := json.Unmarshal([]byte(res[1]), &n); err != nil {
		return domain.Notification{}, fmt.Errorf("notify.redis.Dequeue: unmarshal: %w", err)
	}
	return n, nil
}

// Compile-time assertion.
var _ domain.Queue = (*RedisQueue)(nil)
