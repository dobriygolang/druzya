package domain

import (
	"testing"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// mkDuoTicket builds a duo-mode QueueTicket relative to `base`.
func mkDuoTicket(elo int, enqOffset time.Duration, base time.Time) QueueTicket {
	return QueueTicket{
		UserID:     uuid.New(),
		Section:    enums.SectionAlgorithms,
		Mode:       enums.ArenaModeDuo2v2,
		Elo:        elo,
		EnqueuedAt: base.Add(enqOffset),
	}
}

func TestPickQuads_FourEqualEloFormsBalancedQuad(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	tickets := []QueueTicket{
		mkDuoTicket(1500, 0, base),
		mkDuoTicket(1500, 0, base),
		mkDuoTicket(1500, 0, base),
		mkDuoTicket(1500, 0, base),
	}
	quads := PickQuads(tickets, base)
	if len(quads) != 1 {
		t.Fatalf("want 1 quad, got %d", len(quads))
	}
	q := quads[0]
	t1 := q.Players[0].Elo + q.Players[1].Elo
	t2 := q.Players[2].Elo + q.Players[3].Elo
	if t1 != t2 {
		t.Fatalf("equal-elo split must be balanced: t1=%d t2=%d", t1, t2)
	}
	if got := q.MeanElo(); got != 1500 {
		t.Fatalf("MeanElo: want 1500, got %d", got)
	}
}

func TestPickQuads_ThreePlayersStaysQueued(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	tickets := []QueueTicket{
		mkDuoTicket(1200, 0, base),
		mkDuoTicket(1300, 0, base),
		mkDuoTicket(1400, 0, base),
	}
	if quads := PickQuads(tickets, base); len(quads) != 0 {
		t.Fatalf("3 players must not form a quad, got %d", len(quads))
	}
}

func TestPickQuads_BalancesUnevenElos(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	// Sorted: 1000, 1100, 1900, 2000.
	// Best balance: pair (1000+2000) vs (1100+1900) — both sum to 3000.
	tickets := []QueueTicket{
		mkDuoTicket(2000, 0, base),
		mkDuoTicket(1100, 0, base),
		mkDuoTicket(1000, 0, base),
		mkDuoTicket(1900, 0, base),
	}
	quads := PickQuads(tickets, base)
	if len(quads) != 1 {
		t.Fatalf("want 1 quad, got %d", len(quads))
	}
	q := quads[0]
	t1 := q.Players[0].Elo + q.Players[1].Elo
	t2 := q.Players[2].Elo + q.Players[3].Elo
	if t1 != t2 {
		t.Fatalf("unbalanced split: t1=%d t2=%d (must be 3000/3000)", t1, t2)
	}
	if q.EloSpread() != 1000 {
		t.Fatalf("EloSpread: want 1000, got %d", q.EloSpread())
	}
}

func TestPickQuads_EightPlayersFormsTwoMatches(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	tickets := []QueueTicket{
		mkDuoTicket(1000, 0, base),
		mkDuoTicket(1010, 0, base),
		mkDuoTicket(1020, 0, base),
		mkDuoTicket(1030, 0, base),
		mkDuoTicket(2000, 0, base),
		mkDuoTicket(2010, 0, base),
		mkDuoTicket(2020, 0, base),
		mkDuoTicket(2030, 0, base),
	}
	quads := PickQuads(tickets, base)
	if len(quads) != 2 {
		t.Fatalf("8 players must form 2 quads, got %d", len(quads))
	}
	// First quad mean ~1015, second ~2015 — they must be split by ELO band.
	if quads[0].MeanElo() > 1500 {
		t.Fatalf("first quad expected to be the low-band group, got mean=%d", quads[0].MeanElo())
	}
	if quads[1].MeanElo() < 1500 {
		t.Fatalf("second quad expected to be the high-band group, got mean=%d", quads[1].MeanElo())
	}
}

func TestPickQuads_FivePlayersFormsOneAndKeepsLeftover(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	tickets := []QueueTicket{
		mkDuoTicket(1000, 0, base),
		mkDuoTicket(1010, 0, base),
		mkDuoTicket(1020, 0, base),
		mkDuoTicket(1030, 0, base),
		mkDuoTicket(1040, 0, base),
	}
	quads := PickQuads(tickets, base)
	if len(quads) != 1 {
		t.Fatalf("5 players must form exactly 1 quad, got %d", len(quads))
	}
	// The single quad consumed 4 lowest ELOs by sort order.
	for _, p := range quads[0].Players {
		if p.Elo > 1030 {
			t.Fatalf("quad must contain the 4 lowest ELOs, got %d", p.Elo)
		}
	}
}

func TestPickQuads_DropsExpiredBeforeForming(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	now := base.Add(DuoQueueTimeout + time.Second) // 1s past timeout for "old" tickets
	tickets := []QueueTicket{
		mkDuoTicket(1000, 0, base),                           // expired
		mkDuoTicket(1010, 0, base),                           // expired
		mkDuoTicket(1020, DuoQueueTimeout-time.Minute, base), // alive
		mkDuoTicket(1030, DuoQueueTimeout-time.Minute, base), // alive
	}
	if quads := PickQuads(tickets, now); len(quads) != 0 {
		t.Fatalf("only 2 live tickets — should not form a quad, got %d quads", len(quads))
	}
}

func TestIsDuoTicketExpired_BoundaryConditions(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	t1 := QueueTicket{EnqueuedAt: base}
	if IsDuoTicketExpired(t1, base.Add(DuoQueueTimeout-time.Second)) {
		t.Fatal("just-before timeout must not be expired")
	}
	if !IsDuoTicketExpired(t1, base.Add(DuoQueueTimeout)) {
		t.Fatal("exactly at timeout must be expired")
	}
	if !IsDuoTicketExpired(t1, base.Add(DuoQueueTimeout+time.Hour)) {
		t.Fatal("long after timeout must be expired")
	}
}

func TestQuad_EloSpreadAndMean(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	q := Quad{Players: [DuoMatchSize]QueueTicket{
		mkDuoTicket(1000, 0, base),
		mkDuoTicket(1500, 0, base),
		mkDuoTicket(1700, 0, base),
		mkDuoTicket(2000, 0, base),
	}}
	if got := q.MeanElo(); got != 1550 {
		t.Fatalf("MeanElo: want 1550, got %d", got)
	}
	if got := q.EloSpread(); got != 1000 {
		t.Fatalf("EloSpread: want 1000, got %d", got)
	}
}

func TestResolveDuoWinner_Team1Wins(t *testing.T) {
	t.Parallel()
	a, b, c, d := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	parts := []Participant{
		{UserID: a, Team: Team1},
		{UserID: b, Team: Team1},
		{UserID: c, Team: Team2},
		{UserID: d, Team: Team2},
	}
	passed := map[uuid.UUID]bool{a: true, b: true}
	team, decided := ResolveDuoWinner(parts, passed)
	if !decided {
		t.Fatal("expected decided=true when both team-1 members passed")
	}
	if team != Team1 {
		t.Fatalf("want winning team 1, got %d", team)
	}
}

func TestResolveDuoWinner_Team2Wins(t *testing.T) {
	t.Parallel()
	a, b, c, d := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	parts := []Participant{
		{UserID: a, Team: Team1},
		{UserID: b, Team: Team1},
		{UserID: c, Team: Team2},
		{UserID: d, Team: Team2},
	}
	passed := map[uuid.UUID]bool{a: true, c: true, d: true}
	team, decided := ResolveDuoWinner(parts, passed)
	if !decided || team != Team2 {
		t.Fatalf("want team 2 winner, got team=%d decided=%v", team, decided)
	}
}

func TestResolveDuoWinner_PartialNotDecided(t *testing.T) {
	t.Parallel()
	a, b, c, d := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	parts := []Participant{
		{UserID: a, Team: Team1},
		{UserID: b, Team: Team1},
		{UserID: c, Team: Team2},
		{UserID: d, Team: Team2},
	}
	// Only one member of team 1 + one of team 2 passed → not decided.
	passed := map[uuid.UUID]bool{a: true, c: true}
	if _, decided := ResolveDuoWinner(parts, passed); decided {
		t.Fatal("must not decide before either team is complete")
	}
}

func TestResolveDuoWinner_DrawWhenBothTeamsCompleteSimultaneously(t *testing.T) {
	t.Parallel()
	a, b, c, d := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	parts := []Participant{
		{UserID: a, Team: Team1},
		{UserID: b, Team: Team1},
		{UserID: c, Team: Team2},
		{UserID: d, Team: Team2},
	}
	passed := map[uuid.UUID]bool{a: true, b: true, c: true, d: true}
	team, decided := ResolveDuoWinner(parts, passed)
	if !decided {
		t.Fatal("when both teams pass we still mark as decided (draw)")
	}
	if team != 0 {
		t.Fatalf("draw expected (winning_team=0), got %d", team)
	}
}

func TestResolveDuoWinner_MalformedTeamComposition(t *testing.T) {
	t.Parallel()
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	parts := []Participant{
		{UserID: a, Team: Team1},
		{UserID: b, Team: Team1},
		{UserID: c, Team: Team2},
		// Missing 4th participant.
	}
	if _, decided := ResolveDuoWinner(parts, map[uuid.UUID]bool{a: true, b: true}); decided {
		t.Fatal("malformed match must not be decided")
	}
}

func TestResultForTeam(t *testing.T) {
	t.Parallel()
	if got := ResultForTeam(Team1, Team1); got != TeamResultWin {
		t.Fatalf("team1 vs winner team1: want win, got %s", got)
	}
	if got := ResultForTeam(Team2, Team1); got != TeamResultLoss {
		t.Fatalf("team2 vs winner team1: want loss, got %s", got)
	}
	if got := ResultForTeam(Team1, 0); got != TeamResultDraw {
		t.Fatalf("team1 with no winning team: want draw, got %s", got)
	}
}

func TestIsDuoMode(t *testing.T) {
	t.Parallel()
	if !IsDuoMode("duo_2v2") {
		t.Fatal("duo_2v2 must be a duo mode")
	}
	if IsDuoMode("solo_1v1") {
		t.Fatal("solo_1v1 must NOT be a duo mode")
	}
	if IsDuoMode("ranked") {
		t.Fatal("ranked must NOT be a duo mode (currently)")
	}
}

func TestBalanceQuad_PrefersAdBcOnTies(t *testing.T) {
	t.Parallel()
	// All 4 tickets have ELO that produces equal sums under multiple splits.
	// 1000, 1500, 1500, 2000 → (1000+2000)=(1500+1500)=3000. Both are valid.
	// The balancer prefers (a,d) vs (b,c) i.e. (1000,2000) vs (1500,1500).
	base := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	w := [DuoMatchSize]QueueTicket{
		mkDuoTicket(1000, 0, base),
		mkDuoTicket(1500, 0, base),
		mkDuoTicket(1500, 0, base),
		mkDuoTicket(2000, 0, base),
	}
	q := balanceQuad(w)
	t1 := q.Players[0].Elo + q.Players[1].Elo
	t2 := q.Players[2].Elo + q.Players[3].Elo
	if t1 != 3000 || t2 != 3000 {
		t.Fatalf("expected balanced 3000/3000, got %d/%d", t1, t2)
	}
	// (a,d)/(b,c) = (1000,2000)/(1500,1500). Verify team composition.
	team1 := []int{q.Players[0].Elo, q.Players[1].Elo}
	if !((team1[0] == 1000 && team1[1] == 2000) || (team1[0] == 2000 && team1[1] == 1000)) {
		t.Fatalf("expected (a,d) split (1000,2000) on team 1, got %v", team1)
	}
}
