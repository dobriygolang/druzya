// cursor_keyset.go — shared keyset-cursor helpers for hone List* repos.
//
// Pattern is identical to notesListCursor in postgres.go: a tiny JSON-
// over-base64 envelope keyed by (timestamp, id). Decoupled so reading,
// listening, external-activity and friends can share the same encoder
// without dragging the whole notes pkg.
package infra

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"
)

// createdAtCursor is the keyset payload for tables sorted by created_at
// (or any other timestamp column). The JSON keys are kept short — these
// strings get round-tripped on the wire.
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
