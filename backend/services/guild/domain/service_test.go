package domain

import (
	"testing"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

func mkWar(scoresA, scoresB map[enums.Section]int) War {
	return War{
		ID:        uuid.New(),
		GuildAID:  uuid.New(),
		GuildBID:  uuid.New(),
		WeekStart: time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC),
		WeekEnd:   time.Date(2026, 4, 27, 0, 0, 0, 0, time.UTC),
		ScoresA:   scoresA,
		ScoresB:   scoresB,
	}
}

func TestIsWarActive_Windows(t *testing.T) {
	t.Parallel()
	w := mkWar(nil, nil)

	// Before start.
	if IsWarActive(w, w.WeekStart.Add(-time.Second)) {
		t.Fatal("pre-start must NOT be active")
	}
	// Exactly start → active (inclusive).
	if !IsWarActive(w, w.WeekStart) {
		t.Fatal("week_start must be active (inclusive)")
	}
	// Mid-week.
	if !IsWarActive(w, w.WeekStart.Add(3*24*time.Hour)) {
		t.Fatal("mid-week must be active")
	}
	// Exactly end → not active (exclusive).
	if IsWarActive(w, w.WeekEnd) {
		t.Fatal("week_end must be exclusive")
	}
	// After end.
	if IsWarActive(w, w.WeekEnd.Add(time.Hour)) {
		t.Fatal("post-end must NOT be active")
	}
}

func TestSideForGuild(t *testing.T) {
	t.Parallel()
	w := mkWar(nil, nil)
	s, ok := SideForGuild(w, w.GuildAID)
	if !ok || s != SideA {
		t.Fatalf("GuildA should map to SideA, got %q ok=%v", s, ok)
	}
	s, ok = SideForGuild(w, w.GuildBID)
	if !ok || s != SideB {
		t.Fatalf("GuildB should map to SideB, got %q ok=%v", s, ok)
	}
	if _, ok := SideForGuild(w, uuid.New()); ok {
		t.Fatal("random uuid must not match any side")
	}
}

func TestCanContribute_ActiveAndSection(t *testing.T) {
	t.Parallel()
	w := mkWar(nil, nil)
	now := w.WeekStart.Add(24 * time.Hour)

	algo := enums.SectionAlgorithms
	m := Member{UserID: uuid.New(), GuildID: w.GuildAID, AssignedSection: &algo}

	if err := CanContribute(m, w, enums.SectionAlgorithms, now); err != nil {
		t.Fatalf("should allow own section: %v", err)
	}
	if err := CanContribute(m, w, enums.SectionSQL, now); err == nil {
		t.Fatal("must reject foreign section")
	}
	// Unassigned member → any section is fine.
	mFree := Member{UserID: uuid.New(), GuildID: w.GuildAID}
	if err := CanContribute(mFree, w, enums.SectionGo, now); err != nil {
		t.Fatalf("unassigned must be allowed any section: %v", err)
	}
	// Invalid section.
	if err := CanContribute(mFree, w, enums.Section("nonsense"), now); err == nil {
		t.Fatal("invalid section must be rejected")
	}
	// Outside war window.
	if err := CanContribute(m, w, enums.SectionAlgorithms, w.WeekEnd.Add(time.Hour)); err == nil {
		t.Fatal("post-end contribution must be rejected")
	}
}

func TestAggregateScore(t *testing.T) {
	t.Parallel()
	if got := AggregateScore(nil); got != 0 {
		t.Fatalf("nil slice: want 0, got %d", got)
	}
	cs := []Contribution{
		{Score: 10}, {Score: 25}, {Score: 7},
	}
	if got := AggregateScore(cs); got != 42 {
		t.Fatalf("want 42, got %d", got)
	}
}

func TestTallyLines_OrderedBySection(t *testing.T) {
	t.Parallel()
	w := mkWar(
		map[enums.Section]int{enums.SectionAlgorithms: 30, enums.SectionSQL: 10},
		map[enums.Section]int{enums.SectionAlgorithms: 20},
	)
	cs := []Contribution{
		{Section: enums.SectionAlgorithms, Side: SideA, UserID: uuid.New(), Score: 30},
		{Section: enums.SectionAlgorithms, Side: SideB, UserID: uuid.New(), Score: 20},
	}
	lines := TallyLines(w, cs)
	if len(lines) != WarLineCount {
		t.Fatalf("expected %d lines, got %d", WarLineCount, len(lines))
	}
	want := enums.AllSections()
	for i, line := range lines {
		if line.Section != want[i] {
			t.Fatalf("line[%d]: want %q got %q", i, want[i], line.Section)
		}
	}
	if lines[0].ScoreA != 30 || lines[0].ScoreB != 20 {
		t.Fatalf("algorithms scores: a=%d b=%d", lines[0].ScoreA, lines[0].ScoreB)
	}
	if len(lines[0].Contributors) != 2 {
		t.Fatalf("contributors should be hydrated on the matching line")
	}
}

func TestDetermineWinner_MajorityA(t *testing.T) {
	t.Parallel()
	w := mkWar(
		map[enums.Section]int{
			enums.SectionAlgorithms:   50, // A wins
			enums.SectionSQL:          50, // A wins
			enums.SectionGo:           50, // A wins
			enums.SectionSystemDesign: 10, // B wins
			enums.SectionBehavioral:   10, // B wins
		},
		map[enums.Section]int{
			enums.SectionAlgorithms:   30,
			enums.SectionSQL:          30,
			enums.SectionGo:           30,
			enums.SectionSystemDesign: 40,
			enums.SectionBehavioral:   40,
		},
	)
	got := DetermineWinner(w)
	if got == nil || *got != w.GuildAID {
		t.Fatalf("expected guild A, got %v", got)
	}
}

func TestDetermineWinner_MajorityB(t *testing.T) {
	t.Parallel()
	w := mkWar(
		map[enums.Section]int{
			enums.SectionAlgorithms: 10,
			enums.SectionSQL:        10,
		},
		map[enums.Section]int{
			enums.SectionAlgorithms:   40,
			enums.SectionSQL:          40,
			enums.SectionGo:           40,
			enums.SectionSystemDesign: 40,
			enums.SectionBehavioral:   40,
		},
	)
	got := DetermineWinner(w)
	if got == nil || *got != w.GuildBID {
		t.Fatalf("expected guild B, got %v", got)
	}
}

func TestDetermineWinner_Draw(t *testing.T) {
	t.Parallel()
	// 2-2-1 (one tied line) → overall draw.
	w := mkWar(
		map[enums.Section]int{
			enums.SectionAlgorithms:   50, // A
			enums.SectionSQL:          50, // A
			enums.SectionGo:           10, // B
			enums.SectionSystemDesign: 10, // B
			enums.SectionBehavioral:   25, // tie
		},
		map[enums.Section]int{
			enums.SectionAlgorithms:   30,
			enums.SectionSQL:          30,
			enums.SectionGo:           40,
			enums.SectionSystemDesign: 40,
			enums.SectionBehavioral:   25, // tie
		},
	)
	if got := DetermineWinner(w); got != nil {
		t.Fatalf("expected nil for draw, got %v", got)
	}
}

func TestDetermineWinner_AllTies(t *testing.T) {
	t.Parallel()
	// Five tied lines → nil.
	scores := map[enums.Section]int{
		enums.SectionAlgorithms:   10,
		enums.SectionSQL:          10,
		enums.SectionGo:           10,
		enums.SectionSystemDesign: 10,
		enums.SectionBehavioral:   10,
	}
	w := mkWar(scores, scores)
	if got := DetermineWinner(w); got != nil {
		t.Fatalf("all-tie war should be a draw, got %v", got)
	}
}

func TestDetermineWinner_EmptyScoresIsDraw(t *testing.T) {
	t.Parallel()
	// Both guilds at zero everywhere → draw.
	w := mkWar(map[enums.Section]int{}, map[enums.Section]int{})
	if got := DetermineWinner(w); got != nil {
		t.Fatalf("zero-score war should be a draw, got %v", got)
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
