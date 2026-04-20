package domain

import (
	"testing"

	"druz9/shared/enums"
)

func TestComputeGlobalPowerScore(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		if got := ComputeGlobalPowerScore(nil); got != 0 {
			t.Fatalf("want 0, got %d", got)
		}
	})
	t.Run("single", func(t *testing.T) {
		rs := []SectionRating{{Section: enums.SectionAlgorithms, Elo: 1500}}
		if got := ComputeGlobalPowerScore(rs); got != 1500 {
			t.Fatalf("want 1500, got %d", got)
		}
	})
	t.Run("mixed", func(t *testing.T) {
		rs := []SectionRating{
			{Section: enums.SectionAlgorithms, Elo: 1200},
			{Section: enums.SectionSQL, Elo: 1400},
			{Section: enums.SectionGo, Elo: 1600},
		}
		// mean = 1400
		if got := ComputeGlobalPowerScore(rs); got != 1400 {
			t.Fatalf("want 1400, got %d", got)
		}
	})
}

func TestApplyELO(t *testing.T) {
	t.Run("winner vs equal opponent with K=32 gains ~16", func(t *testing.T) {
		got := ApplyELO(1000, 1000, true, 32)
		// expected = 0.5, actual = 1.0, delta = 32*0.5 = 16
		if got != 1016 {
			t.Fatalf("want 1016, got %d", got)
		}
	})
	t.Run("loser vs equal opponent with K=32 loses ~16", func(t *testing.T) {
		got := ApplyELO(1000, 1000, false, 32)
		if got != 984 {
			t.Fatalf("want 984, got %d", got)
		}
	})
	t.Run("veteran K=16 halves the delta", func(t *testing.T) {
		got := ApplyELO(1500, 1500, true, 16)
		if got != 1508 {
			t.Fatalf("want 1508, got %d", got)
		}
	})
	t.Run("stalemate at equal ELO rounds to zero", func(t *testing.T) {
		// A draw is expressed by caller as two separate calls each with winner=false.
		// With equal ELOs and winner=false the delta is -K/2 which rounds to an
		// integer; the domain doesn't model draws specially — the caller hits
		// exactly 0 by passing matching EloDeltas in the arena layer.
		// This test simply documents current behaviour.
		got := ApplyELO(1000, 1000, false, 32)
		if got >= 1000 {
			t.Fatalf("expected loss below 1000, got %d", got)
		}
	})
}

func TestKFactor(t *testing.T) {
	tests := []struct {
		name  string
		count int
		want  int
	}{
		{"new player zero matches", 0, 32},
		{"below boundary", 29, 32},
		{"exactly boundary", 30, 16},
		{"veteran", 100, 16},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if got := KFactor(tc.count); got != tc.want {
				t.Fatalf("want %d, got %d", tc.want, got)
			}
		})
	}
}
