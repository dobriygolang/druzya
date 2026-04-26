// redis_canvas_drafts.go — CanvasDraftStore on Redis. Fallback-only:
// the frontend writes here exclusively when the browser localStorage
// quota is exhausted. Under normal load Redis stays empty.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// RedisCanvasDrafts implements domain.CanvasDraftStore on a redis.Client.
type RedisCanvasDrafts struct {
	rdb *redis.Client
}

// NewRedisCanvasDrafts wires the adapter.
func NewRedisCanvasDrafts(rdb *redis.Client) *RedisCanvasDrafts {
	return &RedisCanvasDrafts{rdb: rdb}
}

func draftKey(id uuid.UUID) string { return "mock:canvas_draft:" + id.String() }

type wireDraft struct {
	SceneJSON       []byte `json:"scene_json"`
	NonFunctionalMD string `json:"nfr_md"`
	ContextMD       string `json:"ctx_md"`
	UpdatedAt       int64  `json:"updated_at_unix_ms"`
}

func (r *RedisCanvasDrafts) Save(ctx context.Context, attemptID uuid.UUID, d domain.CanvasDraft) error {
	w := wireDraft{
		SceneJSON:       d.SceneJSON,
		NonFunctionalMD: d.NonFunctionalMD,
		ContextMD:       d.ContextMD,
		UpdatedAt:       d.UpdatedAt.UnixMilli(),
	}
	payload, err := json.Marshal(w)
	if err != nil {
		return fmt.Errorf("mock_interview.RedisCanvasDrafts.Save: marshal: %w", err)
	}
	if len(payload) > domain.CanvasDraftMaxBytes {
		return fmt.Errorf("draft size %d > cap %d: %w",
			len(payload), domain.CanvasDraftMaxBytes, domain.ErrValidation)
	}
	if err := r.rdb.Set(ctx, draftKey(attemptID), payload, domain.CanvasDraftTTL).Err(); err != nil {
		return fmt.Errorf("mock_interview.RedisCanvasDrafts.Save: %w", err)
	}
	return nil
}

func (r *RedisCanvasDrafts) Get(ctx context.Context, attemptID uuid.UUID) (domain.CanvasDraft, error) {
	raw, err := r.rdb.Get(ctx, draftKey(attemptID)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return domain.CanvasDraft{}, domain.ErrNotFound
		}
		return domain.CanvasDraft{}, fmt.Errorf("mock_interview.RedisCanvasDrafts.Get: %w", err)
	}
	var w wireDraft
	if err := json.Unmarshal(raw, &w); err != nil {
		return domain.CanvasDraft{}, fmt.Errorf("mock_interview.RedisCanvasDrafts.Get: unmarshal: %w", err)
	}
	return domain.CanvasDraft{
		SceneJSON:       w.SceneJSON,
		NonFunctionalMD: w.NonFunctionalMD,
		ContextMD:       w.ContextMD,
		UpdatedAt:       time.UnixMilli(w.UpdatedAt).UTC(),
	}, nil
}

func (r *RedisCanvasDrafts) Delete(ctx context.Context, attemptID uuid.UUID) error {
	if err := r.rdb.Del(ctx, draftKey(attemptID)).Err(); err != nil {
		return fmt.Errorf("mock_interview.RedisCanvasDrafts.Delete: %w", err)
	}
	return nil
}

// Compile-time assertion.
var _ domain.CanvasDraftStore = (*RedisCanvasDrafts)(nil)
