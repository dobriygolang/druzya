package domain

import (
	"sync"
	"testing"

	"druz9/shared/enums"
)

func TestXPToNext(t *testing.T) {
	t.Parallel()
	// Level 1 → 500; ensure strictly increasing across the practical range.
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
	// Defensive: zero / negative levels should clamp to level=1, not panic.
	if got := XPToNext(0); got != 500 {
		t.Fatalf("XPToNext(0) clamp to 500; got %d", got)
	}
	if got := XPToNext(-5); got != 500 {
		t.Fatalf("XPToNext(-5) clamp to 500; got %d", got)
	}
}

func TestApplyXP(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		startLevel int
		startXP    int64
		gain       int
		wantNew    int
		wantOld    int
		wantRemain int64
	}{
		{"single-level-up", 1, 400, 150, 2, 1, 50},
		{"no-level-up", 2, 100, 10, 2, 2, 110},
		{"exact-threshold", 1, 0, 500, 2, 1, 0},
		{"clamp-zero-level", 0, 0, 100, 1, 1, 100},
		// Pre-computed: lv1→lv2 burns 500, lv2→lv3 burns round(500*2^1.5)=1414,
		// lv3→lv4 burns round(500*3^1.5)=2598; remainder = 5000-500-1414-2598 = 488.
		{"large-gain-multi-level", 1, 0, 5000, 4, 1, 488},
		{"zero-gain-noop", 5, 200, 0, 5, 5, 200},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			p := Profile{Level: c.startLevel, XP: c.startXP}
			gotNew, gotOld, gotRem := ApplyXP(p, c.gain)
			if gotNew != c.wantNew || gotOld != c.wantOld || gotRem != c.wantRemain {
				t.Fatalf("ApplyXP(lvl=%d, xp=%d, +%d) = (new=%d, old=%d, rem=%d), want (%d, %d, %d)",
					c.startLevel, c.startXP, c.gain,
					gotNew, gotOld, gotRem,
					c.wantNew, c.wantOld, c.wantRemain)
			}
		})
	}
}

func TestApplyXP_HardCapAt100(t *testing.T) {
	t.Parallel()
	// Pathological huge gain shouldn't loop forever — the implementation caps
	// the climb at 100. We just assert termination + sane upper bound.
	p := Profile{Level: 50, XP: 0}
	newLvl, _, _ := ApplyXP(p, 1<<30)
	if newLvl > 101 {
		t.Fatalf("expected hard cap at 100, got newLvl=%d", newLvl)
	}
}

func TestGlobalPowerScore(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   []SectionRating
		want int
	}{
		{
			name: "two-sections-others-baseline",
			in: []SectionRating{
				{Section: enums.SectionAlgorithms, Elo: 1500},
				{Section: enums.SectionSQL, Elo: 1200},
			},
			want: 1140, // (1500 + 1200 + 1000 + 1000 + 1000)/5
		},
		{
			name: "all-baseline",
			in:   nil,
			want: 1000,
		},
		{
			name: "invalid-section-ignored",
			in: []SectionRating{
				{Section: enums.Section("garbage"), Elo: 9999},
			},
			want: 1000,
		},
		{
			name: "all-sections-set",
			in: []SectionRating{
				{Section: enums.SectionAlgorithms, Elo: 1600},
				{Section: enums.SectionSQL, Elo: 1400},
				{Section: enums.SectionGo, Elo: 1500},
				{Section: enums.SectionSystemDesign, Elo: 1300},
				{Section: enums.SectionBehavioral, Elo: 1200},
			},
			want: 1400,
		},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := GlobalPowerScore(c.in); got != c.want {
				t.Fatalf("GlobalPowerScore = %d, want %d", got, c.want)
			}
		})
	}
}

func TestCareerStageFromPowerScore(t *testing.T) {
	t.Parallel()
	cases := map[int]CareerStage{
		0:    CareerStageJunior,
		900:  CareerStageJunior,
		1099: CareerStageJunior,
		1100: CareerStageMiddle,
		1299: CareerStageMiddle,
		1300: CareerStageSenior,
		1499: CareerStageSenior,
		1500: CareerStageStaff,
		1799: CareerStageStaff,
		1800: CareerStagePrincipal,
		2400: CareerStagePrincipal,
	}
	for score, want := range cases {
		if got := CareerStageFromPowerScore(score); got != want {
			t.Errorf("CareerStageFromPowerScore(%d) = %q, want %q", score, got, want)
		}
		if !want.IsValid() {
			t.Errorf("derived stage %q must satisfy IsValid()", want)
		}
	}
}

func TestDeriveAttributes_BoundsAndMapping(t *testing.T) {
	t.Parallel()
	// ELO 800 → 0; 2200 → 100; mid → 50.
	in := []SectionRating{
		{Section: enums.SectionAlgorithms, Elo: 800},
		{Section: enums.SectionSystemDesign, Elo: 2200},
		{Section: enums.SectionSQL, Elo: 1500},
		{Section: enums.SectionGo, Elo: 1800},
		{Section: enums.SectionBehavioral, Elo: 1500},
	}
	a := DeriveAttributes(in)
	if a.Intellect != 0 {
		t.Errorf("Intellect = %d, want 0", a.Intellect)
	}
	if a.Strength != 100 {
		t.Errorf("Strength = %d, want 100", a.Strength)
	}
	if a.Dexterity < 70 || a.Dexterity > 75 {
		// 1800 maps to (1800-800)*100/1400 = 71
		t.Errorf("Dexterity = %d, want ~71", a.Dexterity)
	}
	if a.Will < 49 || a.Will > 51 {
		t.Errorf("Will = %d, want ~50", a.Will)
	}
}

func TestDeriveAttributes_BelowFloorClamps(t *testing.T) {
	t.Parallel()
	in := []SectionRating{{Section: enums.SectionAlgorithms, Elo: 100}}
	a := DeriveAttributes(in)
	if a.Intellect != 0 {
		t.Fatalf("expected Intellect=0 for sub-floor ELO, got %d", a.Intellect)
	}
}

func TestDeriveAttributes_AboveCeilingClamps(t *testing.T) {
	t.Parallel()
	in := []SectionRating{{Section: enums.SectionAlgorithms, Elo: 9999}}
	a := DeriveAttributes(in)
	if a.Intellect != 100 {
		t.Fatalf("expected Intellect=100 for sky-high ELO, got %d", a.Intellect)
	}
}

// TestPureFunctions_ConcurrentSafe asserts the pure score/attribute helpers
// don't share mutable state (caught early if anyone introduces a global
// memoization cache without a mutex).
func TestPureFunctions_ConcurrentSafe(t *testing.T) {
	t.Parallel()
	in := []SectionRating{
		{Section: enums.SectionAlgorithms, Elo: 1500},
		{Section: enums.SectionSQL, Elo: 1300},
	}
	const N = 200
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			if got := GlobalPowerScore(in); got <= 0 {
				t.Errorf("unexpected GPS %d", got)
			}
			_ = DeriveAttributes(in)
			_ = XPToNext(7)
		}()
	}
	wg.Wait()
}
