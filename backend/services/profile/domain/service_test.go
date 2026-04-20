package domain

import (
	"testing"

	"druz9/shared/enums"
)

func TestXPToNext(t *testing.T) {
	t.Parallel()
	// Level 1 → 500; 4 → 500 * 8 = 4000; ensure strictly increasing.
	prev := int64(0)
	for lvl := 1; lvl <= 20; lvl++ {
		v := XPToNext(lvl)
		if v <= prev {
			t.Fatalf("expected strictly increasing XPToNext; lvl=%d got=%d prev=%d", lvl, v, prev)
		}
		prev = v
	}
	if got := XPToNext(1); got != 500 {
		t.Fatalf("XPToNext(1) = %d, want 500", got)
	}
}

func TestApplyXP_LevelUp(t *testing.T) {
	t.Parallel()
	p := Profile{Level: 1, XP: 400}
	newLvl, oldLvl, remaining := ApplyXP(p, 150)
	if newLvl != 2 || oldLvl != 1 {
		t.Fatalf("expected level up 1→2, got %d→%d", oldLvl, newLvl)
	}
	if remaining != 50 { // 400 + 150 = 550; -500 threshold = 50.
		t.Fatalf("expected remainder=50, got %d", remaining)
	}
}

func TestApplyXP_NoLevelUp(t *testing.T) {
	t.Parallel()
	p := Profile{Level: 2, XP: 100}
	newLvl, oldLvl, remaining := ApplyXP(p, 10)
	if newLvl != 2 || oldLvl != 2 {
		t.Fatalf("expected stay at 2, got %d→%d", oldLvl, newLvl)
	}
	if remaining != 110 {
		t.Fatalf("expected remainder=110, got %d", remaining)
	}
}

func TestGlobalPowerScore(t *testing.T) {
	t.Parallel()
	ratings := []SectionRating{
		{Section: enums.SectionAlgorithms, Elo: 1500},
		{Section: enums.SectionSQL, Elo: 1200},
		// Go, SystemDesign, Behavioral implicitly 1000 (baseline).
	}
	// (1500 + 1200 + 1000 + 1000 + 1000) / 5 = 1140.
	if got := GlobalPowerScore(ratings); got != 1140 {
		t.Fatalf("GlobalPowerScore = %d, want 1140", got)
	}
}

func TestCareerStageFromPowerScore(t *testing.T) {
	t.Parallel()
	cases := map[int]CareerStage{
		900:  CareerStageJunior,
		1100: CareerStageMiddle,
		1300: CareerStageSenior,
		1500: CareerStageStaff,
		1800: CareerStagePrincipal,
		2400: CareerStagePrincipal,
	}
	for score, want := range cases {
		if got := CareerStageFromPowerScore(score); got != want {
			t.Errorf("CareerStageFromPowerScore(%d) = %q, want %q", score, got, want)
		}
	}
}
