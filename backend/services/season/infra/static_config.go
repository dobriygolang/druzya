// Package infra holds Postgres + static-config adapters for the season domain.
//
// ── Hardcoded reward + challenge configuration (MVP) ──────────────────────
//
// Bible §3.8 says rewards and weekly challenges should eventually come from an
// admin CMS (a `season_rewards` table + a `weekly_challenges` table). Until
// that ships, we expose them as static struct literals here so the domain has
// something concrete to grade against.
//
// STUB: swap these slices for a database-backed ChallengeRepo / TierRepo
// implementation once the CMS migration lands.
//
// Layout:
//
//	FreeTiers    — 40 tiers on the Free track, ladder 100 → 4000 SP.
//	PremiumTiers — 40 tiers on the Premium track, identical point thresholds
//	               but richer rewards. Gated by Progress.IsPremium.
//	WeeklyChallenges — 5 challenge slots; 1 "always on", 4 week-specific.
package infra

import (
	"context"

	"druz9/season/domain"

	"github.com/google/uuid"
)

// FreeTiers is the hardcoded Free-track ladder (40 tiers).
//
// Rewards cycle through avatar_frame / title / aura to exercise all kinds the
// frontend renders. Kept deliberately flat (every 100 SP) so reviewers can
// grok the shape at a glance.
var FreeTiers = buildLadder(100, []string{"avatar_frame", "title", "aura", "avatar_frame"})

// PremiumTiers is the hardcoded Premium-track ladder (40 tiers).
//
// Same RequiredPoints as FreeTiers — on parity the premium row grants the
// bigger-ticket reward (ai_credits, premium aura etc.). Visibility is gated
// by Progress.IsPremium; see domain.CanClaim.
var PremiumTiers = buildLadder(100, []string{"ai_credits", "aura", "title", "avatar_frame"})

// WeeklyChallenges is the hardcoded challenge template for the current season.
// Keep this list between 3 and 5 entries per bible §3.8.
//
// STUB: replace with a DB-driven generator that rotates per ISO week.
var WeeklyChallenges = []domain.WeeklyChallenge{
	{
		Key:          "weekly_win_streak",
		Title:        "Weekly Win Streak",
		Description:  "Win 3 arena matches this week",
		Target:       3,
		PointsReward: 150,
		IsoWeek:      0, // every week
	},
	{
		Key:          "weekly_kata_grind",
		Title:        "Kata Grind",
		Description:  "Complete 5 daily katas this week",
		Target:       5,
		PointsReward: 100,
		IsoWeek:      0,
	},
	{
		Key:          "weekly_mock_run",
		Title:        "Mock Run",
		Description:  "Finish 2 AI mocks this week",
		Target:       2,
		PointsReward: 120,
		IsoWeek:      0,
	},
	{
		Key:          "weekly_cursed_hunt",
		Title:        "Cursed Hunt",
		Description:  "Complete a cursed kata",
		Target:       1,
		PointsReward: 200,
		IsoWeek:      0,
	},
}

// buildLadder generates a 40-tier ladder with rewards cycling through kinds.
func buildLadder(step int, rewardKinds []string) []domain.TierDef {
	const tierCount = 40
	out := make([]domain.TierDef, 0, tierCount)
	for i := 1; i <= tierCount; i++ {
		kind := rewardKinds[(i-1)%len(rewardKinds)]
		out = append(out, domain.TierDef{
			Tier:           i,
			RequiredPoints: i * step,
			RewardKey:      rewardKeyFor(kind, i),
			RewardType:     kind,
		})
	}
	return out
}

// rewardKeyFor returns a stable identifier the profile/inventory domains can
// key against. Format is "<kind>_<tier>" — downstream can derive the asset
// path/CDN URL from this key.
func rewardKeyFor(kind string, tier int) string {
	// Use a small hand-rolled formatter (no strconv.Itoa import noise) since
	// the go compiler folds this in tests anyway.
	switch tier {
	case 1, 2, 3, 4, 5, 6, 7, 8, 9:
		return kind + "_0" + string(rune('0'+tier))
	}
	// General case: not worth importing strconv for a single hotspot —
	// fall back to a helper.
	return kind + "_" + formatInt(tier)
}

func formatInt(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// StaticTiers is the TierRepo implementation backed by the hardcoded slices
// above. Wire via NewStaticTiers() in main.go.
type StaticTiers struct{}

// NewStaticTiers wires a StaticTiers.
func NewStaticTiers() *StaticTiers { return &StaticTiers{} }

// Tracks returns the hardcoded ladder for the given kind.
func (s *StaticTiers) Tracks(_ context.Context, _ uuid.UUID, kind domain.TrackKind) ([]domain.TierDef, error) {
	switch kind {
	case domain.TrackFree:
		return FreeTiers, nil
	case domain.TrackPremium:
		return PremiumTiers, nil
	}
	return nil, domain.ErrNotFound
}

// StaticChallenges is the ChallengeRepo implementation backed by the hardcoded
// slice above.
type StaticChallenges struct{}

// NewStaticChallenges wires a StaticChallenges.
func NewStaticChallenges() *StaticChallenges { return &StaticChallenges{} }

// List returns every challenge in the hardcoded template.
func (s *StaticChallenges) List(_ context.Context, _ uuid.UUID) ([]domain.WeeklyChallenge, error) {
	out := make([]domain.WeeklyChallenge, len(WeeklyChallenges))
	copy(out, WeeklyChallenges)
	return out, nil
}

// Active filters the hardcoded template via domain.ActiveWeekChallenges.
func (s *StaticChallenges) Active(_ context.Context, _ uuid.UUID, isoWeek int) ([]domain.WeeklyChallenge, error) {
	return domain.ActiveWeekChallenges(WeeklyChallenges, isoWeek), nil
}

// Compile-time assertions.
var (
	_ domain.TierRepo      = (*StaticTiers)(nil)
	_ domain.ChallengeRepo = (*StaticChallenges)(nil)
)
