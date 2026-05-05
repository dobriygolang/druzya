// cursor_keyset.go — keyset-cursor envelopes for tutor List* repos.
//
// JSON-over-base64; same pattern as ai_tutor + hone. Two flavours so
// each List* signature stays self-documenting at the call site.
package infra

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"
)

// createdAtCursor — for tables ordered by (created_at, id).
type createdAtCursor struct {
	CreatedAt time.Time `json:"t"`
	ID        string    `json:"i"`
}

func encodeCreatedAtCursor(c createdAtCursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeCreatedAtCursor(s string) (createdAtCursor, error) {
	if s == "" {
		return createdAtCursor{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return createdAtCursor{}, fmt.Errorf("decode cursor: %w", err)
	}
	var c createdAtCursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return createdAtCursor{}, fmt.Errorf("unmarshal cursor: %w", err)
	}
	return c, nil
}

// scheduledAtCursor — for tables ordered by (scheduled_at, id) — events.
type scheduledAtCursor struct {
	ScheduledAt time.Time `json:"s"`
	ID          string    `json:"i"`
}

func encodeScheduledAtCursor(c scheduledAtCursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeScheduledAtCursor(s string) (scheduledAtCursor, error) {
	if s == "" {
		return scheduledAtCursor{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return scheduledAtCursor{}, fmt.Errorf("decode cursor: %w", err)
	}
	var c scheduledAtCursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return scheduledAtCursor{}, fmt.Errorf("unmarshal cursor: %w", err)
	}
	return c, nil
}
