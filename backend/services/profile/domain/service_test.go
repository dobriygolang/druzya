package domain

import (
	"sync"
	"testing"
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

// TestPureFunctions_ConcurrentSafe asserts XPToNext doesn't share mutable
// state (caught early if anyone introduces a global memoization cache
// without a mutex).
func TestPureFunctions_ConcurrentSafe(t *testing.T) {
	t.Parallel()
	const N = 200
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			_ = XPToNext(7)
		}()
	}
	wg.Wait()
}
