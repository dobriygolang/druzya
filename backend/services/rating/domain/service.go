package domain

import "math"

// InitialELO is the seed rating for a user that has not played in a section yet.
const InitialELO = 1000

// ComputeGlobalPowerScore is a weighted average of per-section ELO.
// Empty input → 0. Single-section → that ELO. Otherwise the mean.
//
// NOTE: bible §3.6 allows per-section weights; for MVP we use equal weights.
// When the admin CMS adds weights, pass them through as a second argument.
func ComputeGlobalPowerScore(rs []SectionRating) int {
	if len(rs) == 0 {
		return 0
	}
	sum := 0
	for _, r := range rs {
		sum += r.Elo
	}
	return sum / len(rs)
}

// ApplyELO returns the new ELO after a single match.
//
//	expected = 1 / (1 + 10^((opponentElo - elo)/400))
//	actual   = 1 if winner, 0 if loser, 0.5 if draw
//	new      = elo + K*(actual - expected)
//
// The `winner` bool carries the outcome; for a draw pass winner=false together
// with equal ELOs — the resulting delta will round to zero.
//
// The caller must compute K via KFactor(matchesCount).
func ApplyELO(elo, opponentElo int, winner bool, kFactor int) int {
	expected := 1.0 / (1.0 + math.Pow(10, float64(opponentElo-elo)/400.0))
	actual := 0.0
	if winner {
		actual = 1.0
	}
	delta := float64(kFactor) * (actual - expected)
	// Standard round-half-to-even via math.Round.
	return elo + int(math.Round(delta))
}

// KFactor returns the ELO K-factor based on a player's match count.
// Bible §3.6: 32 while new (<30 matches), 16 for veterans.
func KFactor(matchesCount int) int {
	if matchesCount < 30 {
		return 32
	}
	return 16
}

// IsDecaying returns true when the last match was over 7 days ago.
// A nil LastMatchAt counts as non-decaying (never played).
func (r SectionRating) IsDecaying(now func() int64) bool {
	if r.LastMatchAt == nil {
		return false
	}
	nowUnix := now()
	diff := nowUnix - r.LastMatchAt.Unix()
	return diff > int64(7*24*3600)
}
