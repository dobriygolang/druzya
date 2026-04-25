// Package domain defines the anonymized, public feed-event shape.
// Real user_ids are never emitted — we hash into a stable pseudo-nickname
// ("Shadow_4821"-style) so the feed is safe to expose without auth.
package domain

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// FeedEvent is a pre-rendered, anonymized event for the public Sanctum feed.
// No PII — user_id is hashed into a deterministic handle.
type FeedEvent struct {
	Kind string    `json:"kind"`
	Text string    `json:"text"`
	At   time.Time `json:"at"`
}

// Kinds emitted by the subscriber.
const (
	KindMatchWin     = "match_win"
	KindMatchLoss    = "match_loss"
	KindKataDone     = "kata_done"
	KindNodeUnlocked = "node_unlocked"
	KindLevelUp      = "level_up"
)

// Handle returns a deterministic pseudo-nickname derived from the user UUID.
// Format: "{WORD}_{4 digits}" — e.g. "Shadow_4821", "Wraith_0913".
var handleWords = [...]string{
	"Shadow", "Wraith", "Void", "Ember", "Rune", "Pale", "Crimson",
	"Ash", "Dusk", "Frost", "Hollow", "Ivory", "Night", "Raven",
	"Sable", "Ruin", "Silent", "Thorn", "Wane", "Zealot",
}

func Handle(id uuid.UUID) string {
	h := sha256.Sum256(id[:])
	word := handleWords[int(h[0])%len(handleWords)]
	n := binary.BigEndian.Uint16(h[1:3]) % 10000
	return fmt.Sprintf("%s_%04d", word, n)
}
