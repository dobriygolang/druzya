package domain

import (
	"time"

	"github.com/google/uuid"
)

// PodcastCompleted is a LOCAL (podcast-only) event fired the first time a
// user reaches the completion threshold on an episode. It is intentionally
// NOT in shared/domain/events.go — downstream domains react via the XPGained
// chain that the app/handlers.go translates from this event.
//
// Topic name is namespaced to avoid collisions if the shared catalog ever
// introduces its own podcast event later.
type PodcastCompleted struct {
	At         time.Time `json:"at"`
	UserID     uuid.UUID `json:"user_id"`
	PodcastID  uuid.UUID `json:"podcast_id"`
	DurationSec int      `json:"duration_sec"`
}

// Topic implements the shared Event interface.
func (PodcastCompleted) Topic() string { return "podcast.Completed" }

// OccurredAt implements the shared Event interface.
func (e PodcastCompleted) OccurredAt() time.Time { return e.At }

// PodcastXPPerEpisode is the default XP reward granted on first completion.
// Eventually pulled from dynamic_config (key "podcast_xp_per_episode") —
// see the env var suggestion in WIRING.md.
//
// STUB: handlers.go uses this constant instead of reading dynamic_config.
const PodcastXPPerEpisode = 50
