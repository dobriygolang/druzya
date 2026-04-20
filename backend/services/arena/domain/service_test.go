package domain

import (
	"testing"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

func mkTicket(elo int, enqOffset time.Duration, base time.Time) QueueTicket {
	return QueueTicket{
		UserID:     uuid.New(),
		Section:    enums.SectionAlgorithms,
		Mode:       enums.ArenaModeSolo1v1,
		Elo:        elo,
		EnqueuedAt: base.Add(enqOffset),
	}
}

func TestEloWindowAt_BaseAndExpansion(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)

	if got := EloWindowAt(base, base); got != EloWindowBase {
		t.Fatalf("t=0: want %d got %d", EloWindowBase, got)
	}
	// +29s should still be at baseline (one step is 30s).
	if got := EloWindowAt(base, base.Add(29*time.Second)); got != EloWindowBase {
		t.Fatalf("t=29s: want base %d got %d", EloWindowBase, got)
	}
	// +30s → +1 step.
	if got := EloWindowAt(base, base.Add(30*time.Second)); got != EloWindowBase+EloWindowStep {
		t.Fatalf("t=30s: want %d got %d", EloWindowBase+EloWindowStep, got)
	}
	// +60s → +2 steps → 600 (cap).
	if got := EloWindowAt(base, base.Add(60*time.Second)); got != EloWindowCap {
		t.Fatalf("t=60s: want cap %d got %d", EloWindowCap, got)
	}
	// +10min → still capped.
	if got := EloWindowAt(base, base.Add(10*time.Minute)); got != EloWindowCap {
		t.Fatalf("t=10m: want cap %d got %d", EloWindowCap, got)
	}
}

func TestPickPairs_WithinWindow(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)
	tickets := []QueueTicket{
		mkTicket(1100, 0, base),
		mkTicket(1200, 0, base),
	}
	pairs := PickPairs(tickets, base)
	if len(pairs) != 1 {
		t.Fatalf("want 1 pair, got %d", len(pairs))
	}
	if pairs[0].A.Elo+pairs[0].B.Elo != 2300 {
		t.Fatalf("unexpected pair composition: %+v", pairs[0])
	}
}

func TestPickPairs_OutsideWindowNoMatch(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)
	// 500 ELO apart, both just enqueued → window 200 → no match.
	tickets := []QueueTicket{
		mkTicket(1000, 0, base),
		mkTicket(1500, 0, base),
	}
	if pairs := PickPairs(tickets, base); len(pairs) != 0 {
		t.Fatalf("expected no pair, got %d", len(pairs))
	}
}

func TestPickPairs_ExpansionAfter30s(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)
	// 350 ELO apart — fails at t=0 (window 200), matches at t=30s (window 400).
	tickets := []QueueTicket{
		mkTicket(1000, 0, base),
		mkTicket(1350, 0, base),
	}
	if pairs := PickPairs(tickets, base); len(pairs) != 0 {
		t.Fatalf("t=0: expected no pair, got %d", len(pairs))
	}
	pairs := PickPairs(tickets, base.Add(30*time.Second))
	if len(pairs) != 1 {
		t.Fatalf("t=30s: want 1 pair, got %d", len(pairs))
	}
}

func TestPickPairs_StalemateTooFew(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)
	if pairs := PickPairs([]QueueTicket{mkTicket(1000, 0, base)}, base); len(pairs) != 0 {
		t.Fatalf("single-ticket queue should yield no pairs")
	}
	if pairs := PickPairs(nil, base); len(pairs) != 0 {
		t.Fatalf("nil queue should yield no pairs")
	}
}

func TestPickPairs_PairsOldestFirst(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)
	// Three tickets, all within window. The older enqueue_at should participate.
	tickets := []QueueTicket{
		mkTicket(1000, 0, base),     // oldest
		mkTicket(1050, time.Second, base),
		mkTicket(1100, 2*time.Second, base),
	}
	pairs := PickPairs(tickets, base.Add(5*time.Second))
	if len(pairs) != 1 {
		t.Fatalf("want 1 pair, got %d", len(pairs))
	}
	// Oldest ticket (elo 1000) must be paired.
	if pairs[0].A.Elo != 1000 && pairs[0].B.Elo != 1000 {
		t.Fatalf("oldest ticket should be matched first, got %+v", pairs[0])
	}
}

func TestDifficultyForEloBand(t *testing.T) {
	t.Parallel()
	cases := map[int]enums.Difficulty{
		900:  enums.DifficultyEasy,
		1299: enums.DifficultyEasy,
		1300: enums.DifficultyMedium,
		1799: enums.DifficultyMedium,
		1800: enums.DifficultyHard,
		2500: enums.DifficultyHard,
	}
	for elo, want := range cases {
		if got := DifficultyForEloBand(elo); got != want {
			t.Errorf("elo=%d: want %q got %q", elo, want, got)
		}
	}
}

func TestReadyCheckExpired(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)
	dl := ReadyCheckDeadline(base)
	if dl != base.Add(ReadyCheckWindow) {
		t.Fatalf("deadline arithmetic: %v", dl)
	}
	if IsReadyCheckExpired(dl, base) {
		t.Fatal("at t=0 must NOT be expired")
	}
	if IsReadyCheckExpired(dl, base.Add(ReadyCheckWindow-time.Millisecond)) {
		t.Fatal("just before deadline must NOT be expired")
	}
	if !IsReadyCheckExpired(dl, base.Add(ReadyCheckWindow)) {
		t.Fatal("exactly at deadline must be expired")
	}
	if !IsReadyCheckExpired(dl, base.Add(ReadyCheckWindow+time.Second)) {
		t.Fatal("after deadline must be expired")
	}
}

func TestAccumulateSuspicion_CrossesHigh(t *testing.T) {
	t.Parallel()
	// 50 + 25 = 75 → crosses.
	next, crossed := AccumulateSuspicion(50, PasteSuspicionBump)
	if next != 75 {
		t.Fatalf("next=%f", next)
	}
	if !crossed {
		t.Fatal("expected threshold crossing")
	}
	// 25 + 25 = 50 → no cross.
	next, crossed = AccumulateSuspicion(25, PasteSuspicionBump)
	if crossed {
		t.Fatalf("must not cross at %f", next)
	}
	// 80 + 25 → already over, shouldn't re-signal.
	next, crossed = AccumulateSuspicion(80, PasteSuspicionBump)
	if next != 105 {
		t.Fatalf("next=%f", next)
	}
	if crossed {
		t.Fatal("already-High should not re-cross")
	}
}

func TestAccumulateSuspicion_MultiplePastes(t *testing.T) {
	t.Parallel()
	score := 0.0
	for i := 0; i < 3; i++ {
		score, _ = AccumulateSuspicion(score, PasteSuspicionBump)
	}
	if score != 75 {
		t.Fatalf("3 pastes = 75, got %f", score)
	}
}

func TestTabSwitchSeverity(t *testing.T) {
	t.Parallel()
	if s := TabSwitchSeverity(1); s != enums.SeverityMedium {
		t.Fatalf("1st: want medium, got %q", s)
	}
	if s := TabSwitchSeverity(2); s != enums.SeverityHigh {
		t.Fatalf("2nd: want high, got %q", s)
	}
	if s := TabSwitchSeverity(10); s != enums.SeverityHigh {
		t.Fatalf("10th: want high, got %q", s)
	}
}

func TestFixedClock(t *testing.T) {
	t.Parallel()
	c := &FixedClock{T: time.Unix(0, 0).UTC()}
	start := c.Now()
	c.Advance(time.Second)
	if !c.Now().After(start) {
		t.Fatalf("Advance should move clock forward")
	}
}
