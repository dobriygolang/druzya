package domain

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Track is the user-facing track persona — mirrors Postgres `track_kind`
// enum from migration 00006_user_tracks.sql. A user can carry several
// tracks in parallel (e.g. dev_senior + english is the canonical sticky
// combo). See docs/feature/tracks.md.
type Track string

const (
	TrackDev            Track = "dev"
	TrackDevSenior      Track = "dev_senior"
	TrackSysanalyst     Track = "sysanalyst"
	TrackProductAnalyst Track = "product_analyst"
	TrackQA             Track = "qa"
	TrackEnglish        Track = "english"
)

// IsValid enforces exhaustive switching downstream.
func (t Track) IsValid() bool {
	switch t {
	case TrackDev, TrackDevSenior, TrackSysanalyst, TrackProductAnalyst, TrackQA, TrackEnglish:
		return true
	}
	return false
}

// String implements fmt.Stringer.
func (t Track) String() string { return string(t) }

// AllTracks lists every supported track. Used by callers that need to
// iterate without hard-coding the slice (e.g. admin dashboards, seeders).
func AllTracks() []Track {
	return []Track{
		TrackDev, TrackDevSenior, TrackSysanalyst,
		TrackProductAnalyst, TrackQA, TrackEnglish,
	}
}

// Seniority is the per-track level for engineering / analyst tracks.
// English does not use seniority (the only cross-cutting track without
// a level distinction in MVP) — store empty string and treat as N/A.
type Seniority string

const (
	SeniorityJunior Seniority = "junior"
	SeniorityMiddle Seniority = "middle"
	SenioritySenior Seniority = "senior"
	SeniorityLead   Seniority = "lead"
)

// IsValid checks whether the value belongs to the closed set. Empty
// string is also valid — it means "not applicable" (used by english).
func (s Seniority) IsValid() bool {
	switch s {
	case "", SeniorityJunior, SeniorityMiddle, SenioritySenior, SeniorityLead:
		return true
	}
	return false
}

// String implements fmt.Stringer.
func (s Seniority) String() string { return string(s) }

// UserTrack mirrors a row in `user_tracks`. Seniority is empty for
// english; required for engineering / analyst tracks (validated in
// app layer, not at the type level — DB CHECK is the safety net).
type UserTrack struct {
	UserID       uuid.UUID
	Track        Track
	Seniority    Seniority
	Primary      bool
	StartedAt    time.Time
	LastActiveAt time.Time
}

// ErrInvalidTracks is returned by SetUserTracks when the incoming list
// breaks the «exactly one primary, all valid, non-empty» invariant.
var ErrInvalidTracks = errors.New("profile: invalid track list")

// ValidateTrackList enforces the invariants enforced by the API surface:
//   - non-empty;
//   - exactly one primary;
//   - no duplicate tracks;
//   - track + seniority both pass IsValid;
//   - english carries empty seniority; non-english must have a value.
//
// Returned error wraps ErrInvalidTracks so callers can errors.Is()
// downstream and map to 400.
func ValidateTrackList(items []UserTrack) error {
	if len(items) == 0 {
		return fmt.Errorf("%w: at least one track required", ErrInvalidTracks)
	}
	primaries := 0
	seen := make(map[Track]struct{}, len(items))
	for i, it := range items {
		if !it.Track.IsValid() {
			return fmt.Errorf("%w: items[%d].track %q invalid", ErrInvalidTracks, i, it.Track)
		}
		if _, dup := seen[it.Track]; dup {
			return fmt.Errorf("%w: items[%d].track %q duplicated", ErrInvalidTracks, i, it.Track)
		}
		seen[it.Track] = struct{}{}
		if !it.Seniority.IsValid() {
			return fmt.Errorf("%w: items[%d].seniority %q invalid", ErrInvalidTracks, i, it.Seniority)
		}
		if it.Track == TrackEnglish && it.Seniority != "" {
			return fmt.Errorf("%w: items[%d] english must have empty seniority", ErrInvalidTracks, i)
		}
		if it.Track != TrackEnglish && it.Seniority == "" {
			return fmt.Errorf("%w: items[%d] track %q requires seniority", ErrInvalidTracks, i, it.Track)
		}
		if it.Primary {
			primaries++
		}
	}
	if primaries != 1 {
		return fmt.Errorf("%w: exactly one item must have primary=true (got %d)", ErrInvalidTracks, primaries)
	}
	return nil
}
