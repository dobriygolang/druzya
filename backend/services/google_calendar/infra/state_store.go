// state_store.go — Redis-backed CSRF nonce store for OAuth state.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/google_calendar/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const stateKeyPrefix = "google_calendar:oauth_state:"

type StateStore struct {
	rdb *redis.Client
}

func NewStateStore(rdb *redis.Client) *StateStore { return &StateStore{rdb: rdb} }

func (s *StateStore) Put(ctx context.Context, state string, userID uuid.UUID, ttl time.Duration) error {
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	if err := s.rdb.Set(ctx, stateKeyPrefix+state, userID.String(), ttl).Err(); err != nil {
		return fmt.Errorf("google_calendar.StateStore.Put: %w", err)
	}
	return nil
}

func (s *StateStore) Consume(ctx context.Context, state string) (uuid.UUID, error) {
	key := stateKeyPrefix + state
	// GETDEL is atomic; returns "" + redis.Nil if missing.
	val, err := s.rdb.GetDel(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return uuid.Nil, domain.ErrInvalidState
		}
		return uuid.Nil, fmt.Errorf("google_calendar.StateStore.Consume: %w", err)
	}
	uid, err := uuid.Parse(val)
	if err != nil {
		return uuid.Nil, fmt.Errorf("google_calendar.StateStore.Consume parse: %w", err)
	}
	return uid, nil
}

var _ domain.StateStore = (*StateStore)(nil)
