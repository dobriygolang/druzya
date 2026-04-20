package domain

import (
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Sentinel errors.
var (
	ErrNotFound       = errors.New("season: not found")
	ErrNoCurrent      = errors.New("season: no current season")
	ErrAlreadyClaimed = errors.New("season: reward already claimed")
	ErrTierNotEarned  = errors.New("season: tier not reached")
)

// TrackKind distinguishes Free vs Premium reward tracks.
type TrackKind string

const (
	TrackFree    TrackKind = "free"
	TrackPremium TrackKind = "premium"
)

// IsValid reports whether the kind is a known track.
func (k TrackKind) IsValid() bool {
	switch k {
	case TrackFree, TrackPremium:
		return true
	}
	return false
}

// Season mirrors a row of `seasons`.
type Season struct {
	ID        uuid.UUID
	Name      string
	Slug      string
	Theme     string
	StartsAt  time.Time
	EndsAt    time.Time
	IsCurrent bool
}

// Progress mirrors a row of `season_progress` for a single (user, season).
type Progress struct {
	UserID    uuid.UUID
	SeasonID  uuid.UUID
	Points    int
	Tier      int
	IsPremium bool
	UpdatedAt time.Time
}

// TierDef is one step on a reward ladder (Free or Premium).
//
// STUB: when the real CMS lands these are loaded from `season_rewards` table
// (see bible §3.8). For MVP they're hardcoded in infra/static_config.go.
type TierDef struct {
	Tier           int
	RequiredPoints int
	RewardKey      string // e.g. "avatar_frame_gold", "title_the_awakener", "ai_credits_100"
	RewardType     string // one of: avatar_frame, title, ai_credits, aura
}

// ClaimState tracks which tiers the user has redeemed on each track. Persisted
// in a JSONB column on `season_progress` in later milestones; MVP keeps this
// in-memory (repo returns an empty set).
type ClaimState struct {
	FreeClaimed    map[int]bool
	PremiumClaimed map[int]bool
}

// NewClaimState returns an initialised state.
func NewClaimState() ClaimState {
	return ClaimState{
		FreeClaimed:    map[int]bool{},
		PremiumClaimed: map[int]bool{},
	}
}

// WeeklyChallenge is an in-memory challenge definition. Challenges are tied to
// ISO weeks and award bonus SP when the per-user progress reaches Target.
//
// STUB: MVP loads challenges from infra/static_config.go. Admin CMS comes
// later — the Repo indirection lets us swap without churn.
type WeeklyChallenge struct {
	Key          string
	Title        string
	Description  string
	Section      *enums.Section // nil = any section
	Target       int
	PointsReward int
	// IsoWeek (1..53) where the challenge is active. 0 == every week.
	IsoWeek int
}

// ChallengeProgress is a single (user, season, week, challenge) tally.
// Persisted in a helper table in later milestones; MVP keeps this in-memory.
type ChallengeProgress struct {
	UserID    uuid.UUID
	SeasonID  uuid.UUID
	Key       string
	Progress  int
	UpdatedAt time.Time
}

// Source labels where the SP came from — used for audit + the published
// SeasonPointsEarned event.
const (
	SourceXP        = "xp_conversion"
	SourceMatchWin  = "match_win"
	SourceDailyKata = "daily_kata"
	SourceMockDone  = "mock_completed"
	SourcePodcast   = "podcast_completed" // only reachable via XPGained chain today
)
