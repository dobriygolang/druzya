// Package domain — 2v2 (duo) matchmaking + result logic.
//
// Phase 5 introduces team play. To keep blast radius small we add a separate
// file rather than overloading entity.go / service.go:
//
//   - Team formation (formFour): given ≥4 candidates, pick the 4 closest in
//     ELO and split them into two teams that minimise sum-ELO difference.
//   - QueueTimeout: a duo ticket waiting longer than DuoQueueTimeout is
//     dropped from matchmaking by the dispatcher.
//   - 2v2 result: a match is won by team_id (1 or 2), not user_id. Winner is
//     declared once both members of a team have a passing submission.
//
// 1v1 callers are NOT affected — none of the existing exports change.
package domain

import (
	"sort"
	"time"

	"github.com/google/uuid"
)

// Team IDs for 2v2 matches. 0 is reserved for the "no team" / 1v1 default
// stored in arena_participants.team to keep 1v1 history rows untouched.
const (
	Team1 = 1
	Team2 = 2
)

// DuoTeamSize is the number of players per side in a duo match.
const DuoTeamSize = 2

// DuoMatchSize is the total number of participants in a duo match.
const DuoMatchSize = DuoTeamSize * 2 // 4

// DuoQueueTimeout — max wait before a duo ticket is cancelled out of the
// queue. The bible asks for "≈5 min". Surfaced so the dispatcher and tests
// agree on the threshold.
const DuoQueueTimeout = 5 * time.Minute

// DuoEloSpreadCap — soft cap on (max - min) ELO across the four picked
// candidates. We still match if exceeded (no match = worse UX than a wide
// match), but the dispatcher logs a wide-spread warning so ops can see it.
const DuoEloSpreadCap = 600

// Quad is the four-player set the matchmaker decided to bring into one duo
// match. Ordering: Players[0..1] = Team1, Players[2..3] = Team2.
type Quad struct {
	Players [DuoMatchSize]QueueTicket
}

// Team1Tickets returns the two tickets assigned to team 1.
func (q Quad) Team1Tickets() [DuoTeamSize]QueueTicket {
	return [DuoTeamSize]QueueTicket{q.Players[0], q.Players[1]}
}

// Team2Tickets returns the two tickets assigned to team 2.
func (q Quad) Team2Tickets() [DuoTeamSize]QueueTicket {
	return [DuoTeamSize]QueueTicket{q.Players[2], q.Players[3]}
}

// MeanElo returns the rounded mean ELO of all four players (used to pick
// task difficulty, mirroring the 1v1 logic).
func (q Quad) MeanElo() int {
	sum := 0
	for _, p := range q.Players {
		sum += p.Elo
	}
	return sum / DuoMatchSize
}

// EloSpread returns max(Elo) - min(Elo) across the quad. Used by the
// dispatcher to decide whether to log a wide-match warning.
func (q Quad) EloSpread() int {
	min, max := q.Players[0].Elo, q.Players[0].Elo
	for _, p := range q.Players[1:] {
		if p.Elo < min {
			min = p.Elo
		}
		if p.Elo > max {
			max = p.Elo
		}
	}
	return max - min
}

// PickQuads greedily groups duo-queue tickets into matches of four.
//
// Strategy (kept simple — bible §3.4 mentions "balanced split", not "global
// optimum"):
//  1. Sort tickets by ELO ascending.
//  2. Walk the slice in windows of four consecutive (closest-ELO) tickets.
//  3. For each window, find the team split that minimises |sumA - sumB|.
//     With 4 players there are only C(4,2)/2 = 3 distinct splits, so this is
//     O(1) per window.
//  4. Mark the four as taken and continue. Leftovers (<4) stay in the queue.
//
// Tickets older than DuoQueueTimeout are filtered out before grouping —
// the dispatcher is responsible for cancelling them out of Redis separately
// (see Matchmaker.cancelStaleDuo).
func PickQuads(tickets []QueueTicket, now time.Time) []Quad {
	if len(tickets) < DuoMatchSize {
		return nil
	}
	// Drop expired tickets so we never form a match with a ghost member.
	live := make([]QueueTicket, 0, len(tickets))
	for _, t := range tickets {
		if !IsDuoTicketExpired(t, now) {
			live = append(live, t)
		}
	}
	if len(live) < DuoMatchSize {
		return nil
	}
	sort.SliceStable(live, func(i, j int) bool {
		if live[i].Elo != live[j].Elo {
			return live[i].Elo < live[j].Elo
		}
		return live[i].EnqueuedAt.Before(live[j].EnqueuedAt)
	})

	quads := make([]Quad, 0, len(live)/DuoMatchSize)
	for i := 0; i+DuoMatchSize <= len(live); i += DuoMatchSize {
		window := [DuoMatchSize]QueueTicket{live[i], live[i+1], live[i+2], live[i+3]}
		quads = append(quads, balanceQuad(window))
	}
	return quads
}

// IsDuoTicketExpired reports whether a duo queue ticket has waited too long.
func IsDuoTicketExpired(t QueueTicket, now time.Time) bool {
	return now.Sub(t.EnqueuedAt) >= DuoQueueTimeout
}

// balanceQuad picks the team split that minimises |sumA - sumB|.
// With 4 elements [a,b,c,d] there are 3 distinct partitions into 2+2:
//
//	(a,b) vs (c,d)   diff = |(a+b) - (c+d)|
//	(a,c) vs (b,d)   diff = |(a+c) - (b+d)|
//	(a,d) vs (b,c)   diff = |(a+d) - (b+c)|
//
// Tie-break: prefer (a,d) vs (b,c) because it pairs the slowest-elo with the
// fastest-elo on each team — empirically the most "fair" feel for players.
func balanceQuad(w [DuoMatchSize]QueueTicket) Quad {
	a, b, c, d := w[0], w[1], w[2], w[3]
	type split struct {
		t1A, t1B QueueTicket
		t2A, t2B QueueTicket
		diff     int
	}
	abs := func(x int) int {
		if x < 0 {
			return -x
		}
		return x
	}
	splits := [3]split{
		{a, b, c, d, abs((a.Elo + b.Elo) - (c.Elo + d.Elo))},
		{a, c, b, d, abs((a.Elo + c.Elo) - (b.Elo + d.Elo))},
		{a, d, b, c, abs((a.Elo + d.Elo) - (b.Elo + c.Elo))},
	}
	best := splits[2] // (a,d)/(b,c) starts as best per tie-break above.
	for _, s := range splits {
		if s.diff < best.diff {
			best = s
		}
	}
	return Quad{Players: [DuoMatchSize]QueueTicket{best.t1A, best.t1B, best.t2A, best.t2B}}
}

// ── 2v2 result resolution ─────────────────────────────────────────────────

// TeamResultLabel — string outcome for a team-mode match from one player's
// perspective. Mirrors the existing MatchResult* set.
const (
	TeamResultWin       = MatchResultWin
	TeamResultLoss      = MatchResultLoss
	TeamResultDraw      = MatchResultDraw
	TeamResultAbandoned = MatchResultAbandoned
)

// ResultForTeam returns the per-player outcome of a finished 2v2 match.
// `myTeam` is the team_id of the requesting player; `winningTeam` is the
// team_id stored on arena_matches.winning_team_id (0 = no winner / draw).
func ResultForTeam(myTeam, winningTeam int) string {
	if winningTeam == 0 {
		return TeamResultDraw
	}
	if myTeam == winningTeam {
		return TeamResultWin
	}
	return TeamResultLoss
}

// ResolveDuoWinner inspects per-participant submissions and returns the
// winning team_id once it can be decided, or 0 when the match is not yet
// resolved. A team wins when *both* its members have a passing submission
// before either of the opposing team's members has all-passed.
//
// `passed` maps userID → did this user submit a passing solution.
// `parts` is the canonical participant list (used to discover team_id).
//
// Returns (winningTeam, decided):
//   - decided=false → match still in progress.
//   - decided=true, winningTeam ∈ {1,2} → that team won.
//   - decided=true, winningTeam=0 → draw (both teams completed in the same
//     resolution call — only meaningful when SubmitCode batches multiple).
func ResolveDuoWinner(parts []Participant, passed map[uuid.UUID]bool) (winningTeam int, decided bool) {
	t1, t2 := 0, 0
	t1Done, t2Done := 0, 0
	for _, p := range parts {
		switch p.Team {
		case Team1:
			t1++
			if passed[p.UserID] {
				t1Done++
			}
		case Team2:
			t2++
			if passed[p.UserID] {
				t2Done++
			}
		}
	}
	if t1 != DuoTeamSize || t2 != DuoTeamSize {
		// Malformed match — refuse to decide.
		return 0, false
	}
	t1Win := t1Done == DuoTeamSize
	t2Win := t2Done == DuoTeamSize
	switch {
	case t1Win && t2Win:
		return 0, true
	case t1Win:
		return Team1, true
	case t2Win:
		return Team2, true
	default:
		return 0, false
	}
}

// IsDuoMode reports whether the given mode plays as 2v2 (currently only
// ArenaModeDuo2v2). Centralised so future duo modes can opt in here.
func IsDuoMode(mode string) bool {
	return mode == "duo_2v2"
}
