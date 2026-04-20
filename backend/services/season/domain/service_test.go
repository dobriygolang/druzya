package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestComputeTier(t *testing.T) {
	ladder := []TierDef{
		{Tier: 1, RequiredPoints: 100},
		{Tier: 2, RequiredPoints: 250},
		{Tier: 3, RequiredPoints: 500},
		{Tier: 4, RequiredPoints: 1000},
	}
	tests := []struct {
		name   string
		points int
		want   int
	}{
		{"zero points", 0, 0},
		{"below first tier", 99, 0},
		{"exactly first tier", 100, 1},
		{"between tiers", 300, 2},
		{"exactly last tier", 1000, 4},
		{"way past last tier", 99999, 4},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := ComputeTier(tc.points, ladder); got != tc.want {
				t.Fatalf("ComputeTier(%d) = %d, want %d", tc.points, got, tc.want)
			}
		})
	}
}

func TestComputeTier_Empty(t *testing.T) {
	if got := ComputeTier(1000, nil); got != 0 {
		t.Fatalf("empty ladder must return 0, got %d", got)
	}
}

func TestActiveWeekChallenges(t *testing.T) {
	all := []WeeklyChallenge{
		{Key: "always", Target: 5, IsoWeek: 0},
		{Key: "wk14", Target: 3, IsoWeek: 14},
		{Key: "wk15", Target: 2, IsoWeek: 15},
	}
	t.Run("week 14 returns always+wk14", func(t *testing.T) {
		got := ActiveWeekChallenges(all, 14)
		if len(got) != 2 {
			t.Fatalf("want 2 active, got %d", len(got))
		}
		keys := map[string]bool{}
		for _, c := range got {
			keys[c.Key] = true
		}
		if !keys["always"] || !keys["wk14"] {
			t.Fatalf("missing expected keys: %v", keys)
		}
	})
	t.Run("off-week returns always-only", func(t *testing.T) {
		got := ActiveWeekChallenges(all, 99)
		if len(got) != 1 || got[0].Key != "always" {
			t.Fatalf("want only 'always', got %+v", got)
		}
	})
	t.Run("timezone edge — last second of Sunday UTC is week N, not N+1", func(t *testing.T) {
		// 2026-04-19 (Sunday) — within ISO week 16 in UTC.
		lastSecondSunday := time.Date(2026, 4, 19, 23, 59, 59, 0, time.UTC)
		// Monday start (00:00) — should flip to week 17.
		firstSecondMonday := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC)
		wkSun := IsoWeekOf(lastSecondSunday)
		wkMon := IsoWeekOf(firstSecondMonday)
		if wkMon-wkSun != 1 {
			t.Fatalf("expected ISO-week rollover across Sun->Mon boundary: got %d -> %d", wkSun, wkMon)
		}
	})
}

func TestIsoWeekOf_NonUTCInput(t *testing.T) {
	// A UTC-12 zone Sunday-20:00 is Monday-08:00 UTC. IsoWeekOf must
	// translate to UTC before computing the ISO week, so a caller in the
	// Western Pacific who labels the instant "Sunday week 16" locally still
	// sees "week 17" here.
	zone := time.FixedZone("UTC-12", -12*3600)
	local := time.Date(2026, 4, 19, 20, 0, 0, 0, zone)
	if got := IsoWeekOf(local); got != 17 {
		t.Fatalf("expected UTC-normalised ISO week 17, got %d", got)
	}
}

func TestSeason_IsActive(t *testing.T) {
	s := Season{
		StartsAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		EndsAt:   time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC),
	}
	if s.IsActive(time.Date(2025, 12, 31, 23, 59, 59, 0, time.UTC)) {
		t.Fatal("must not be active before StartsAt")
	}
	if !s.IsActive(time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("must be active in the middle of the window")
	}
	if s.IsActive(time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("EndsAt is exclusive")
	}
}

func TestCanClaim(t *testing.T) {
	tiers := []TierDef{
		{Tier: 1, RequiredPoints: 100},
		{Tier: 2, RequiredPoints: 250},
	}
	userID := uuid.New()
	seasonID := uuid.New()
	_ = userID
	_ = seasonID

	t.Run("tier reached on free track — allowed", func(t *testing.T) {
		p := Progress{Points: 100}
		if err := CanClaim(p, tiers, NewClaimState(), TrackFree, 1); err != nil {
			t.Fatalf("expected allow, got %v", err)
		}
	})
	t.Run("tier not reached — rejected", func(t *testing.T) {
		p := Progress{Points: 50}
		if err := CanClaim(p, tiers, NewClaimState(), TrackFree, 1); err != ErrTierNotEarned {
			t.Fatalf("want ErrTierNotEarned, got %v", err)
		}
	})
	t.Run("already claimed — rejected", func(t *testing.T) {
		p := Progress{Points: 250}
		st := NewClaimState()
		st.FreeClaimed[1] = true
		if err := CanClaim(p, tiers, st, TrackFree, 1); err != ErrAlreadyClaimed {
			t.Fatalf("want ErrAlreadyClaimed, got %v", err)
		}
	})
	t.Run("premium tier for free user — rejected", func(t *testing.T) {
		p := Progress{Points: 100, IsPremium: false}
		if err := CanClaim(p, tiers, NewClaimState(), TrackPremium, 1); err != ErrTierNotEarned {
			t.Fatalf("free user claiming premium should be rejected, got %v", err)
		}
	})
	t.Run("invalid track", func(t *testing.T) {
		if err := CanClaim(Progress{Points: 100}, tiers, NewClaimState(), TrackKind("bogus"), 1); err != ErrNotFound {
			t.Fatalf("want ErrNotFound for invalid track, got %v", err)
		}
	})
	t.Run("unknown tier", func(t *testing.T) {
		if err := CanClaim(Progress{Points: 999}, tiers, NewClaimState(), TrackFree, 99); err != ErrNotFound {
			t.Fatalf("want ErrNotFound for unknown tier, got %v", err)
		}
	})
}

// Point-math determinism: identical inputs → identical outputs, regardless of
// map iteration order. Done with a loop rather than a table because we're
// guarding against flakiness not coverage.
func TestPointMathDeterminism(t *testing.T) {
	want := ComputeTier(321, []TierDef{
		{Tier: 1, RequiredPoints: 100},
		{Tier: 2, RequiredPoints: 250},
		{Tier: 3, RequiredPoints: 500},
	})
	for i := 0; i < 200; i++ {
		got := ComputeTier(321, []TierDef{
			{Tier: 1, RequiredPoints: 100},
			{Tier: 2, RequiredPoints: 250},
			{Tier: 3, RequiredPoints: 500},
		})
		if got != want {
			t.Fatalf("iteration %d: non-deterministic result %d vs %d", i, got, want)
		}
	}
}
