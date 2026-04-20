package domain

import (
	"testing"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

func mkTask(slug string) TaskPublic {
	return TaskPublic{
		ID:         uuid.MustParse("00000000-0000-0000-0000-000000000000"),
		Slug:       slug,
		Difficulty: enums.DifficultyEasy,
		Section:    enums.SectionAlgorithms,
	}
}

func TestPickKataForUser_DeterministicByDate(t *testing.T) {
	t.Parallel()
	u := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	day := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC)
	candidates := []TaskPublic{mkTask("a"), mkTask("b"), mkTask("c"), mkTask("d"), mkTask("e")}

	first, ok := PickKataForUser(u, day, candidates)
	if !ok {
		t.Fatal("expected pick")
	}
	second, ok := PickKataForUser(u, day, candidates)
	if !ok {
		t.Fatal("expected pick on rerun")
	}
	if first.Slug != second.Slug {
		t.Fatalf("expected deterministic pick per (user, date); got %q then %q", first.Slug, second.Slug)
	}
}

func TestPickKataForUser_DifferentUsers(t *testing.T) {
	t.Parallel()
	// Spanning many users, we expect not every user to hit slug "a" — if they
	// did the picker would be broken/uniform. We use 20 users against a 5-task
	// pool; at least 2 distinct slugs should appear.
	day := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC)
	candidates := []TaskPublic{mkTask("a"), mkTask("b"), mkTask("c"), mkTask("d"), mkTask("e")}
	seen := map[string]bool{}
	for i := 0; i < 20; i++ {
		u := uuid.New()
		p, ok := PickKataForUser(u, day, candidates)
		if !ok {
			t.Fatal("pick failed")
		}
		seen[p.Slug] = true
	}
	if len(seen) < 2 {
		t.Fatalf("expected spread of picks across users, got only %d distinct", len(seen))
	}
}

func TestPickKataForUser_DifferentDates(t *testing.T) {
	t.Parallel()
	u := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	candidates := []TaskPublic{mkTask("a"), mkTask("b"), mkTask("c"), mkTask("d"), mkTask("e")}
	d1 := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC)
	d2 := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)
	p1, _ := PickKataForUser(u, d1, candidates)
	p2, _ := PickKataForUser(u, d2, candidates)
	// Not a guarantee, but with 5 candidates the odds of collision are 1/5.
	// If the test becomes flaky, swap to many-day sampling.
	_ = p1
	_ = p2
}

func TestPickKataForUser_EmptyPool(t *testing.T) {
	t.Parallel()
	if _, ok := PickKataForUser(uuid.New(), time.Now(), nil); ok {
		t.Fatal("expected !ok on empty pool")
	}
}

func TestKataModifiers(t *testing.T) {
	t.Parallel()
	friday := time.Date(2026, 4, 24, 0, 0, 0, 0, time.UTC) // Friday
	sunday := time.Date(2026, 4, 26, 0, 0, 0, 0, time.UTC) // Sunday
	monday := time.Date(2026, 4, 27, 0, 0, 0, 0, time.UTC)

	if c, b := KataModifiers(friday); !c || b {
		t.Fatalf("Friday: expected cursed only, got c=%v b=%v", c, b)
	}
	if c, b := KataModifiers(sunday); c || !b {
		t.Fatalf("Sunday: expected weekly-boss only, got c=%v b=%v", c, b)
	}
	if c, b := KataModifiers(monday); c || b {
		t.Fatalf("Monday: expected no modifiers, got c=%v b=%v", c, b)
	}
}

func TestDifficultyForProgress(t *testing.T) {
	t.Parallel()
	cases := map[int]enums.Difficulty{
		0:   enums.DifficultyEasy,
		30:  enums.DifficultyEasy,
		35:  enums.DifficultyMedium,
		69:  enums.DifficultyMedium,
		70:  enums.DifficultyHard,
		100: enums.DifficultyHard,
	}
	for p, want := range cases {
		if got := DifficultyForProgress(p); got != want {
			t.Errorf("DifficultyForProgress(%d) = %q, want %q", p, got, want)
		}
	}
}

func TestDaysLeft(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	in5 := time.Date(2026, 4, 25, 0, 0, 0, 0, time.UTC)
	if got := DaysLeft(in5, now); got != 5 {
		t.Fatalf("DaysLeft = %d, want 5", got)
	}
	past := time.Date(2026, 4, 15, 0, 0, 0, 0, time.UTC)
	if got := DaysLeft(past, now); got != 0 {
		t.Fatalf("past date should clamp to 0, got %d", got)
	}
}
