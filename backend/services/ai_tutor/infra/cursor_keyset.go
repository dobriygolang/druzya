// cursor_keyset.go — keyset-cursor envelope for ai_tutor List* queries.
//
// JSON-over-base64; same pattern as hone/notesListCursor. Kept local
// to ai_tutor/infra to keep package boundaries tight (no shared util pkg
// for what's effectively two files in the whole monolith).
package infra

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"
)

type aiTutorCursor struct {
	UpdatedAt time.Time `json:"u"`
	ID        string    `json:"i"`
}

func encodeAITutorCursor(c aiTutorCursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeAITutorCursor(s string) (aiTutorCursor, error) {
	if s == "" {
		return aiTutorCursor{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return aiTutorCursor{}, fmt.Errorf("decode cursor: %w", err)
	}
	var c aiTutorCursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return aiTutorCursor{}, fmt.Errorf("unmarshal cursor: %w", err)
	}
	return c, nil
}
