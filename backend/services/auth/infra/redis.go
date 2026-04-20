package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/auth/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// RedisSessions persists refresh sessions under `session:{id}` with a TTL
// equal to the refresh-token lifetime. Keyed storage lets us revoke on
// logout or password rotate without ditching the JWT signing secret.
type RedisSessions struct {
	rdb *redis.Client
	ttl time.Duration
}

// NewRedisSessions wires a session repo. `refreshTTL` should match the JWT config.
func NewRedisSessions(rdb *redis.Client, refreshTTL time.Duration) *RedisSessions {
	return &RedisSessions{rdb: rdb, ttl: refreshTTL}
}

type sessionDTO struct {
	UserID    uuid.UUID `json:"uid"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
	UserAgent string    `json:"ua,omitempty"`
	IP        string    `json:"ip,omitempty"`
}

func sessionKey(id uuid.UUID) string { return "session:" + id.String() }

// Create persists the session JSON with the configured TTL.
func (r *RedisSessions) Create(ctx context.Context, s domain.Session) error {
	dto := sessionDTO{
		UserID:    s.UserID,
		CreatedAt: s.CreatedAt,
		ExpiresAt: s.ExpiresAt,
		UserAgent: s.UserAgent,
		IP:        s.IP,
	}
	b, err := json.Marshal(dto)
	if err != nil {
		return fmt.Errorf("auth.RedisSessions.Create: marshal: %w", err)
	}
	ttl := time.Until(s.ExpiresAt)
	if ttl <= 0 {
		ttl = r.ttl
	}
	if err := r.rdb.Set(ctx, sessionKey(s.ID), b, ttl).Err(); err != nil {
		return fmt.Errorf("auth.RedisSessions.Create: set: %w", err)
	}
	return nil
}

// Get loads a session. Returns domain.ErrNotFound on miss.
func (r *RedisSessions) Get(ctx context.Context, id uuid.UUID) (domain.Session, error) {
	raw, err := r.rdb.Get(ctx, sessionKey(id)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return domain.Session{}, domain.ErrNotFound
		}
		return domain.Session{}, fmt.Errorf("auth.RedisSessions.Get: %w", err)
	}
	var dto sessionDTO
	if err := json.Unmarshal(raw, &dto); err != nil {
		return domain.Session{}, fmt.Errorf("auth.RedisSessions.Get: unmarshal: %w", err)
	}
	return domain.Session{
		ID:        id,
		UserID:    dto.UserID,
		CreatedAt: dto.CreatedAt,
		ExpiresAt: dto.ExpiresAt,
		UserAgent: dto.UserAgent,
		IP:        dto.IP,
	}, nil
}

// Delete removes the session key. Missing keys are not an error.
func (r *RedisSessions) Delete(ctx context.Context, id uuid.UUID) error {
	if err := r.rdb.Del(ctx, sessionKey(id)).Err(); err != nil {
		return fmt.Errorf("auth.RedisSessions.Delete: %w", err)
	}
	return nil
}

// RedisRateLimiter is a fixed-window counter keyed per caller+endpoint.
type RedisRateLimiter struct {
	rdb *redis.Client
}

// NewRedisRateLimiter constructs the limiter over a shared client.
func NewRedisRateLimiter(rdb *redis.Client) *RedisRateLimiter {
	return &RedisRateLimiter{rdb: rdb}
}

// Allow increments the counter and returns (remaining, retryAfterSec, err).
// Returns domain.ErrRateLimited wrapped when quota is exhausted.
func (r *RedisRateLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (int, int, error) {
	n, err := r.rdb.Incr(ctx, key).Result()
	if err != nil {
		return 0, 0, fmt.Errorf("auth.RedisRateLimiter.Allow: incr: %w", err)
	}
	if n == 1 {
		// First hit of the window — attach the TTL.
		if err := r.rdb.Expire(ctx, key, window).Err(); err != nil {
			return 0, 0, fmt.Errorf("auth.RedisRateLimiter.Allow: expire: %w", err)
		}
	}
	if int(n) > limit {
		ttl, err := r.rdb.TTL(ctx, key).Result()
		if err != nil || ttl < 0 {
			ttl = window
		}
		return 0, int(ttl.Seconds()), fmt.Errorf("auth.RedisRateLimiter.Allow: %w", domain.ErrRateLimited)
	}
	return limit - int(n), 0, nil
}
