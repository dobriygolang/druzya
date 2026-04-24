package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// embedQueueKey — Redis List, FIFO для embedding-job'ов. Producers (Create/
// UpdateNote handlers) делают LPUSH, worker — BRPOP (pop с хвоста → oldest
// wins). Имя неймспейснуто по сервису чтобы не сталкивалось с notify.
const embedQueueKey = "queue:hone:embed"

// EmbedJob — payload в очереди. Минимальный по размеру: берём текст из
// note на момент enqueue, чтобы worker не дёргал DB лишний раз. Если к
// моменту обработки note переписали — в очереди будет второй job, это
// нормально (idempotent SetEmbedding).
type EmbedJob struct {
	UserID uuid.UUID `json:"u"`
	NoteID uuid.UUID `json:"n"`
	Text   string    `json:"t"`
}

// RedisEmbedQueue — очередь embedding-job'ов на Redis List.
//
// Почему persistent queue вместо `go func(){...}`: в Phase 4 embed был
// fire-and-forget через goroutine (см. makeHoneEmbedJob в monolith wiring).
// При рестарте сервиса inflight job'ы терялись → GetNoteConnections не
// находил connections для заметок, созданных в последние ~секунды до
// deploy'а. Redis AOF/RDB гарантирует, что очередь переживает рестарт.
type RedisEmbedQueue struct {
	rdb *redis.Client
}

// NewRedisEmbedQueue конструирует очередь поверх общего Redis-клиента.
func NewRedisEmbedQueue(rdb *redis.Client) *RedisEmbedQueue {
	return &RedisEmbedQueue{rdb: rdb}
}

// Enqueue LPUSH'ит JSON-encoded job. Вызывается из CreateNote/UpdateNote
// app-handler'ов (см. monolith/services/hone.go — makeHoneEmbedJob).
func (q *RedisEmbedQueue) Enqueue(ctx context.Context, job EmbedJob) error {
	raw, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("hone.embed.Enqueue: marshal: %w", err)
	}
	if err := q.rdb.LPush(ctx, embedQueueKey, raw).Err(); err != nil {
		return fmt.Errorf("hone.embed.Enqueue: LPUSH: %w", err)
	}
	return nil
}

// Dequeue BRPOP'ит с небольшим таймаутом чтобы ctx cancellation проходил
// без tight-loop'а Redis. Worker вызывает в цикле.
//
// Возвращает (EmbedJob{}, context.DeadlineExceeded) на idle-тик — это
// нормальный сигнал loop'у «итерация прошла впустую, продолжай».
func (q *RedisEmbedQueue) Dequeue(ctx context.Context) (EmbedJob, error) {
	res, err := q.rdb.BRPop(ctx, 2*time.Second, embedQueueKey).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return EmbedJob{}, context.DeadlineExceeded
		}
		return EmbedJob{}, fmt.Errorf("hone.embed.Dequeue: BRPOP: %w", err)
	}
	if len(res) != 2 {
		return EmbedJob{}, fmt.Errorf("hone.embed.Dequeue: unexpected BRPOP shape %d", len(res))
	}
	var job EmbedJob
	if err := json.Unmarshal([]byte(res[1]), &job); err != nil {
		return EmbedJob{}, fmt.Errorf("hone.embed.Dequeue: unmarshal: %w", err)
	}
	return job, nil
}

// Len возвращает текущий размер очереди. Используется в /metrics.
func (q *RedisEmbedQueue) Len(ctx context.Context) (int64, error) {
	n, err := q.rdb.LLen(ctx, embedQueueKey).Result()
	if err != nil {
		return 0, fmt.Errorf("hone.embed.Len: %w", err)
	}
	return n, nil
}

// Ensure interface compat (declared in app to avoid infra->app import).
var _ = domain.Embedder(nil)
