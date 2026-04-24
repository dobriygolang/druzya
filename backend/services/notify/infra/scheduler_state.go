package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisSchedulerState — persistent store для last-fired bucket'ов scheduler'ов.
// Ключ-value: <key> → RFC3339 timestamp. TTL ставит caller.
//
// Используется WeeklyReportScheduler (и потенциально другими периодическими
// scheduler'ами), чтобы рестарт API в окне fire-часа не повторял fan-out
// ВСЕМ подписчикам. См. подробности в notify/app/scheduler.go.
type RedisSchedulerState struct {
	rds *redis.Client
}

// NewRedisSchedulerState создаёт state-store. Если rds == nil — возвращает
// nil, вызывающий код должен проверить и упасть на in-memory путь.
func NewRedisSchedulerState(rds *redis.Client) *RedisSchedulerState {
	if rds == nil {
		return nil
	}
	return &RedisSchedulerState{rds: rds}
}

// GetLastFired читает последнее сохранённое время для ключа. redis.Nil →
// (zero, nil) — "ещё не стреляли, коннект ок". Реальные ошибки пробрасываем.
func (s *RedisSchedulerState) GetLastFired(ctx context.Context, key string) (time.Time, error) {
	raw, err := s.rds.Get(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return time.Time{}, nil
		}
		return time.Time{}, fmt.Errorf("notify.scheduler_state.Get: %w", err)
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		// Corrupt значение — лечим удалением ключа, следующий запуск
		// начнёт с чистого листа (не spam'а).
		_ = s.rds.Del(ctx, key).Err()
		return time.Time{}, fmt.Errorf("notify.scheduler_state.Get: parse %q: %w", raw, err)
	}
	return t, nil
}

// SetLastFired сохраняет время + TTL атомарно через SET EX.
func (s *RedisSchedulerState) SetLastFired(ctx context.Context, key string, t time.Time, ttl time.Duration) error {
	if err := s.rds.Set(ctx, key, t.UTC().Format(time.RFC3339), ttl).Err(); err != nil {
		return fmt.Errorf("notify.scheduler_state.Set: %w", err)
	}
	return nil
}
