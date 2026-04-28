package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/quiz/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// RedisSessionStore persists active quiz sessions in Redis with TTL.
// Key: quiz:session:{uuid}, value: JSON-encoded domain.Session.
type RedisSessionStore struct {
	rdb *redis.Client
}

// NewRedisSessionStore wires the store.
func NewRedisSessionStore(rdb *redis.Client) *RedisSessionStore {
	return &RedisSessionStore{rdb: rdb}
}

// Save serialises the session and sets it with TTL = ExpiresAt - now.
func (s *RedisSessionStore) Save(ctx context.Context, sess domain.Session) error {
	if s.rdb == nil {
		return fmt.Errorf("quiz.RedisSessionStore.Save: redis not configured")
	}
	ttl := time.Until(sess.ExpiresAt)
	if ttl <= 0 {
		return fmt.Errorf("quiz.RedisSessionStore.Save: %w", domain.ErrSessionExpired)
	}
	raw, err := json.Marshal(sess)
	if err != nil {
		return fmt.Errorf("quiz.RedisSessionStore.Save: marshal: %w", err)
	}
	if err := s.rdb.Set(ctx, sessionKey(sess.ID), raw, ttl).Err(); err != nil {
		return fmt.Errorf("quiz.RedisSessionStore.Save: set: %w", err)
	}
	return nil
}

// Get returns the session or domain.ErrNotFound when absent / expired.
func (s *RedisSessionStore) Get(ctx context.Context, id uuid.UUID) (domain.Session, error) {
	if s.rdb == nil {
		return domain.Session{}, fmt.Errorf("quiz.RedisSessionStore.Get: redis not configured")
	}
	raw, err := s.rdb.Get(ctx, sessionKey(id)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return domain.Session{}, domain.ErrNotFound
		}
		return domain.Session{}, fmt.Errorf("quiz.RedisSessionStore.Get: %w", err)
	}
	var sess domain.Session
	if err := json.Unmarshal(raw, &sess); err != nil {
		return domain.Session{}, fmt.Errorf("quiz.RedisSessionStore.Get: unmarshal: %w", err)
	}
	if time.Now().After(sess.ExpiresAt) {
		_ = s.rdb.Del(ctx, sessionKey(id)).Err()
		return domain.Session{}, domain.ErrSessionExpired
	}
	return sess, nil
}

// Delete removes the session unconditionally.
func (s *RedisSessionStore) Delete(ctx context.Context, id uuid.UUID) error {
	if s.rdb == nil {
		return nil
	}
	if err := s.rdb.Del(ctx, sessionKey(id)).Err(); err != nil {
		return fmt.Errorf("quiz.RedisSessionStore.Delete: %w", err)
	}
	return nil
}

func sessionKey(id uuid.UUID) string { return "quiz:session:" + id.String() }

// Compile-time guard.
var _ domain.SessionStore = (*RedisSessionStore)(nil)
