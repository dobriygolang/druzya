package domain

import (
	"sort"
	"time"

	"druz9/shared/enums"
)

// ELO-window bible §3.4: ±200 baseline, +200 every 30s in queue, capped at ±600.
const (
	EloWindowBase   = 200
	EloWindowStep   = 200
	EloWindowCap    = 600
	EloWindowStepAt = 30 * time.Second
)

// Clock abstracts time.Now so tests can drive Tick() deterministically.
type Clock interface {
	Now() time.Time
}

// RealClock is the production Clock.
type RealClock struct{}

// Now returns time.Now in UTC.
func (RealClock) Now() time.Time { return time.Now().UTC() }

// FixedClock is a test Clock returning a fixed instant; call Advance to move it.
type FixedClock struct{ T time.Time }

// Now returns the fixed instant.
func (c *FixedClock) Now() time.Time { return c.T }

// Advance moves the clock forward by d.
func (c *FixedClock) Advance(d time.Duration) { c.T = c.T.Add(d) }

// EloWindowAt returns the permissible |elo_a − elo_b| delta for a ticket
// enqueued at `enqueuedAt`, observed at `now`.
func EloWindowAt(enqueuedAt, now time.Time) int {
	waited := now.Sub(enqueuedAt)
	if waited < 0 {
		waited = 0
	}
	steps := int(waited / EloWindowStepAt)
	win := EloWindowBase + steps*EloWindowStep
	if win > EloWindowCap {
		win = EloWindowCap
	}
	if win < EloWindowBase {
		win = EloWindowBase
	}
	return win
}

// PickPairs greedily matches adjacent tickets in an ELO-sorted queue slice.
// It assumes `tickets` is owned by the caller and must not mutate it.
//
// Strategy:
//  1. Sort tickets by ELO ascending, tiebreak on enqueue time so the
//     oldest ticket gets matched first.
//  2. Walk the slice in order; for each unmatched ticket, try to pair with the
//     next unmatched ticket whose ELO fits inside the dynamically-expanded
//     window of *either* side (we take max so a long-waiter broadens the net).
//
// Returns the set of matched pairs; tickets that did not find a partner this
// tick stay in the queue.
func PickPairs(tickets []QueueTicket, now time.Time) []Pair {
	if len(tickets) < 2 {
		return nil
	}
	ts := append([]QueueTicket(nil), tickets...)
	sort.SliceStable(ts, func(i, j int) bool {
		if ts[i].Elo != ts[j].Elo {
			return ts[i].Elo < ts[j].Elo
		}
		return ts[i].EnqueuedAt.Before(ts[j].EnqueuedAt)
	})

	taken := make([]bool, len(ts))
	pairs := make([]Pair, 0, len(ts)/2)
	for i := 0; i < len(ts); i++ {
		if taken[i] {
			continue
		}
		for j := i + 1; j < len(ts); j++ {
			if taken[j] {
				continue
			}
			delta := ts[j].Elo - ts[i].Elo
			if delta < 0 {
				delta = -delta
			}
			winI := EloWindowAt(ts[i].EnqueuedAt, now)
			winJ := EloWindowAt(ts[j].EnqueuedAt, now)
			win := winI
			if winJ > win {
				win = winJ
			}
			if delta <= win {
				taken[i] = true
				taken[j] = true
				pairs = append(pairs, Pair{A: ts[i], B: ts[j]})
				break
			}
			// ELO-sorted: the next j would be even further; skip rest.
			break
		}
	}
	return pairs
}

// DifficultyForEloBand chooses a task difficulty from an ELO value. Pure.
func DifficultyForEloBand(elo int) enums.Difficulty {
	switch {
	case elo >= 1800:
		return enums.DifficultyHard
	case elo >= 1300:
		return enums.DifficultyMedium
	default:
		return enums.DifficultyEasy
	}
}

// ReadyCheckDeadline returns `now + ReadyCheckWindow`.
func ReadyCheckDeadline(now time.Time) time.Time { return now.Add(ReadyCheckWindow) }

// IsReadyCheckExpired reports whether the deadline has passed.
func IsReadyCheckExpired(deadline, now time.Time) bool { return !now.Before(deadline) }

// AccumulateSuspicion applies a paste event to an existing score, returning the
// new value and whether the High threshold was crossed.
func AccumulateSuspicion(current, delta float64) (newScore float64, crossedHigh bool) {
	prev := current
	newScore = current + delta
	if prev < SuspicionHighThreshold && newScore >= SuspicionHighThreshold {
		crossedHigh = true
	}
	return
}

// TabSwitchSeverity maps the Nth (1-based) tab-switch to an anticheat severity.
// 1 → Medium, ≥2 → High (bible §3.4).
func TabSwitchSeverity(nth int) enums.SeverityLevel {
	if nth <= 1 {
		return enums.SeverityMedium
	}
	return enums.SeverityHigh
}
