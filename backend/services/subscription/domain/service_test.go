package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestTierRank_Monotonic(t *testing.T) {
	if TierRank(TierFree) >= TierRank(TierSeeker) {
		t.Fatal("free ≥ seeker")
	}
	if TierRank(TierSeeker) >= TierRank(TierAscended) {
		t.Fatal("seeker ≥ ascended")
	}
	if TierRank("unknown") != 0 {
		t.Fatal("unknown tier must rank 0")
	}
}

func TestHasAccess(t *testing.T) {
	cases := []struct {
		user, required Tier
		want           bool
	}{
		{TierFree, TierFree, true},
		{TierFree, TierSeeker, false},
		{TierFree, TierAscended, false},
		{TierSeeker, TierFree, true},
		{TierSeeker, TierSeeker, true},
		{TierSeeker, TierAscended, false},
		{TierAscended, TierFree, true},
		{TierAscended, TierSeeker, true},
		{TierAscended, TierAscended, true},
	}
	for _, c := range cases {
		if got := HasAccess(c.user, c.required); got != c.want {
			t.Errorf("HasAccess(%s, %s) = %v, want %v", c.user, c.required, got, c.want)
		}
	}
}

func TestSubscription_ActiveAt(t *testing.T) {
	now := time.Date(2026, 4, 25, 12, 0, 0, 0, time.UTC)
	past := now.Add(-24 * time.Hour)
	future := now.Add(24 * time.Hour)

	t.Run("free tier always free", func(t *testing.T) {
		s := Subscription{Tier: TierFree, Status: StatusActive, CurrentPeriodEnd: &future}
		if s.ActiveAt(now) != TierFree {
			t.Fatal("free must stay free")
		}
	})

	t.Run("cancelled degrades to free even before expiry", func(t *testing.T) {
		s := Subscription{Tier: TierSeeker, Status: StatusCancelled, CurrentPeriodEnd: &future}
		if s.ActiveAt(now) != TierFree {
			t.Fatal("cancelled must degrade")
		}
	})

	t.Run("expired by current_period_end degrades", func(t *testing.T) {
		s := Subscription{Tier: TierSeeker, Status: StatusActive, CurrentPeriodEnd: &past}
		if s.ActiveAt(now) != TierFree {
			t.Fatal("past CPE must degrade")
		}
	})

	t.Run("grace period extends beyond CPE", func(t *testing.T) {
		s := Subscription{
			Tier:             TierAscended,
			Status:           StatusActive,
			CurrentPeriodEnd: &past,
			GraceUntil:       &future,
		}
		if s.ActiveAt(now) != TierAscended {
			t.Fatal("grace must keep tier active")
		}
	})

	t.Run("admin grant without expiry stays active", func(t *testing.T) {
		s := Subscription{Tier: TierAscended, Status: StatusActive, Provider: ProviderAdmin}
		if s.ActiveAt(now) != TierAscended {
			t.Fatal("admin grant must stay active bessrochno")
		}
	})
}

func TestProvider_IsValid(t *testing.T) {
	valid := []Provider{ProviderBoosty, ProviderYookassa, ProviderTBank, ProviderAdmin}
	for _, p := range valid {
		if !p.IsValid() {
			t.Errorf("%s must be valid", p)
		}
	}
	if Provider("stripe").IsValid() {
		t.Error("stripe must be invalid until explicitly added")
	}
}

// Ensure fake UserID doesn't cause compilation drift.
var _ = uuid.New()
