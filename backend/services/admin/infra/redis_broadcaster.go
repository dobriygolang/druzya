package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"druz9/admin/domain"

	"github.com/redis/go-redis/v9"
)

// ConfigChannel is the Redis Pub/Sub channel that every dynconfig subscriber
// listens on. Payload is a single JSON envelope describing the entry that
// changed, so subscribers can update an in-memory cache without re-reading PG.
//
// Bible §7 — Dynamic Config: target end-to-end propagation is ≤ 100 ms, so we
// fire-and-forget publish here (no retries, no backoff). If Redis is down the
// next cache refresh will still catch up via the periodic poller on the
// subscriber side.
const ConfigChannel = "dynconfig:cache"

// configChangePayload is the wire shape.
//
// Fields mirror ConfigEntry exactly so decoders do not have to cross-reference
// two structs. Value is a raw JSON blob — the subscriber may unmarshal into
// the type hinted by `Type`.
type configChangePayload struct {
	Key         string          `json:"key"`
	Value       json.RawMessage `json:"value"`
	Type        string          `json:"type"`
	Description string          `json:"description,omitempty"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

// RedisBroadcaster publishes ConfigEntry updates onto ConfigChannel. Each
// publish also targets a per-key channel (`dynconfig:changed:{key}`) so
// consumers that only care about one knob can subscribe narrowly.
type RedisBroadcaster struct {
	rdb *redis.Client
}

// NewRedisBroadcaster wires a broadcaster.
func NewRedisBroadcaster(rdb *redis.Client) *RedisBroadcaster {
	return &RedisBroadcaster{rdb: rdb}
}

// Publish fanned the entry out on two channels.
func (b *RedisBroadcaster) Publish(ctx context.Context, entry domain.ConfigEntry) error {
	if b == nil || b.rdb == nil {
		return nil
	}
	payload, err := json.Marshal(configChangePayload{
		Key:         entry.Key,
		Value:       entry.Value,
		Type:        string(entry.Type),
		Description: entry.Description,
		UpdatedAt:   entry.UpdatedAt.UTC(),
	})
	if err != nil {
		return fmt.Errorf("admin.RedisBroadcaster.Publish: marshal: %w", err)
	}
	// Global fan-out.
	if err := b.rdb.Publish(ctx, ConfigChannel, payload).Err(); err != nil {
		return fmt.Errorf("admin.RedisBroadcaster.Publish: %s: %w", ConfigChannel, err)
	}
	// Per-key channel — subscribers wanting sub-ms notification for a single
	// knob can listen here.
	perKey := fmt.Sprintf("dynconfig:changed:%s", entry.Key)
	if err := b.rdb.Publish(ctx, perKey, payload).Err(); err != nil {
		return fmt.Errorf("admin.RedisBroadcaster.Publish: %s: %w", perKey, err)
	}
	return nil
}

// Compile-time assertion.
var _ domain.ConfigBroadcaster = (*RedisBroadcaster)(nil)
