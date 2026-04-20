package domain

import "time"

// ApplyProgress returns an updated Progress row given a new listened_sec
// measurement. It applies the auto-completion threshold (duration - 10s) and
// clamps listened_sec into [0, durationSec].
//
// The function is pure — it never reads or writes state, so callers can unit
// test the threshold logic with no fakes.
//
// Behaviour:
//   - listened_sec ≤ 0         → listened_sec = 0, not completed
//   - listened_sec ≥ duration  → listened_sec = duration, completed now
//   - listened_sec ≥ duration-10 → completed now
//   - otherwise                → just bump listened_sec
//
// Completion is sticky: if the caller passes a Progress whose CompletedAt is
// already set, it is preserved regardless of the new listened_sec (a user
// scrubbing backwards in the player does NOT revert completion).
func ApplyProgress(cur Progress, newListenedSec, durationSec int, now time.Time) Progress {
	if newListenedSec < 0 {
		newListenedSec = 0
	}
	if durationSec > 0 && newListenedSec > durationSec {
		newListenedSec = durationSec
	}
	out := cur
	out.ListenedSec = newListenedSec
	if cur.CompletedAt != nil {
		// Already completed — don't revert.
		return out
	}
	if durationSec > 0 && newListenedSec >= durationSec-CompletionThresholdSec {
		ts := now
		out.CompletedAt = &ts
	}
	return out
}

// WasJustCompleted reports whether the transition from `before` to `after`
// flipped CompletedAt from nil to non-nil. Handy for the app layer that
// decides whether to publish the one-shot PodcastCompleted event.
func WasJustCompleted(before, after Progress) bool {
	return before.CompletedAt == nil && after.CompletedAt != nil
}
