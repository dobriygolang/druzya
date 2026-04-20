package domain

import (
	"time"
)

// DefaultSPPerXPRatio is the fallback SP-per-XP divider used by the XPGained
// handler. 10 XP ⇒ 1 SP. Real value will come from dynamic_config (key
// "sp_per_xp_ratio") once the lookup is wired.
//
// STUB: see services/season/app/handlers.go — the handler currently hardcodes
// this constant instead of reading dynamic_config.
const DefaultSPPerXPRatio = 10

// Points awarded for each non-XP source (bible §3.8).
const (
	PointsMatchWin       = 50
	PointsDailyKata      = 30
	PointsDailyKataCurse = 90 // cursed ×3
	PointsMockFinished   = 80

	// MockMinScoreForSP is the threshold below which a finished mock grants 0 SP.
	MockMinScoreForSP = 60
)

// ComputeTier returns the highest tier.Tier whose RequiredPoints ≤ points.
// Tiers must be sorted by RequiredPoints ASC; the caller is responsible for
// ordering (the hardcoded ladder in infra is already sorted).
//
// Returns 0 when the user hasn't reached the first rung or when tiers is empty.
func ComputeTier(points int, tiers []TierDef) int {
	out := 0
	for _, t := range tiers {
		if t.RequiredPoints <= points {
			if t.Tier > out {
				out = t.Tier
			}
		}
	}
	return out
}

// ActiveWeekChallenges filters the season's challenge set down to those live
// in the given ISO week. A challenge with IsoWeek == 0 is considered "every
// week" and is always included.
//
// The function is purposely side-effect free; timezone handling is the
// caller's concern (pass a pre-computed ISO week int).
func ActiveWeekChallenges(all []WeeklyChallenge, isoWeek int) []WeeklyChallenge {
	out := make([]WeeklyChallenge, 0, len(all))
	for _, c := range all {
		if c.IsoWeek == 0 || c.IsoWeek == isoWeek {
			out = append(out, c)
		}
	}
	return out
}

// IsoWeekOf returns the ISO 8601 week number of t in UTC. Small helper so
// callers don't repeat t.UTC().ISOWeek() three times in tests.
func IsoWeekOf(t time.Time) int {
	_, wk := t.UTC().ISOWeek()
	return wk
}

// IsActive reports whether the given instant falls inside [StartsAt, EndsAt).
// Used by app to short-circuit "no current season" responses.
func (s Season) IsActive(now time.Time) bool {
	return !now.Before(s.StartsAt) && now.Before(s.EndsAt)
}

// CanClaim returns nil when (kind, tier) can be redeemed: the user has earned
// enough points for the tier AND hasn't claimed it yet.
func CanClaim(p Progress, tiers []TierDef, state ClaimState, kind TrackKind, tier int) error {
	if !kind.IsValid() {
		return ErrNotFound
	}
	if tier <= 0 {
		return ErrTierNotEarned
	}
	// Find the tier definition.
	var def *TierDef
	for i := range tiers {
		if tiers[i].Tier == tier {
			def = &tiers[i]
			break
		}
	}
	if def == nil {
		return ErrNotFound
	}
	if p.Points < def.RequiredPoints {
		return ErrTierNotEarned
	}
	// Premium gates — free users cannot redeem premium tiers.
	if kind == TrackPremium && !p.IsPremium {
		return ErrTierNotEarned
	}
	claimed := state.FreeClaimed
	if kind == TrackPremium {
		claimed = state.PremiumClaimed
	}
	if claimed[tier] {
		return ErrAlreadyClaimed
	}
	return nil
}
