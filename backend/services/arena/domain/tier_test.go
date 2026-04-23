package domain

import "testing"

func TestTierLabel_DiamondTier(t *testing.T) {
	t.Parallel()
	cur, next := TierLabel(2150)
	if cur != "Diamond III" {
		t.Fatalf("expected Diamond III, got %s", cur)
	}
	if next != "Diamond II · 50 LP" {
		t.Fatalf("expected next 'Diamond II · 50 LP', got %s", next)
	}
}

func TestTierLabel_BronzeFloor(t *testing.T) {
	t.Parallel()
	cur, next := TierLabel(0)
	if cur != "Bronze IV" {
		t.Fatalf("expected Bronze IV at zero, got %s", cur)
	}
	if next == "" {
		t.Fatal("expected next tier present at floor")
	}
}

func TestTierLabel_MasterCap(t *testing.T) {
	t.Parallel()
	cur, next := TierLabel(2500)
	if cur != "Master" {
		t.Fatalf("expected Master at 2500, got %s", cur)
	}
	if next != "" {
		t.Fatalf("expected empty next at Master cap, got %s", next)
	}
}

func TestTierLabel_NegativeClamped(t *testing.T) {
	t.Parallel()
	cur, _ := TierLabel(-100)
	if cur != "Bronze IV" {
		t.Fatalf("expected Bronze IV for negative ELO, got %s", cur)
	}
}

func TestComputeXP_WinFastFirstTry(t *testing.T) {
	t.Parallel()
	total, items := ComputeXP(true, false, 240, true, 1)
	if total != XPWin+XPWinFast+XPWinFirstTry {
		t.Fatalf("expected total %d, got %d", XPWin+XPWinFast+XPWinFirstTry, total)
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 breakdown items, got %d", len(items))
	}
}

func TestComputeXP_WinNoBonuses(t *testing.T) {
	t.Parallel()
	total, items := ComputeXP(true, false, 0, false, 1)
	if total != XPWin {
		t.Fatalf("expected %d, got %d", XPWin, total)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
}

func TestComputeXP_WinWithStreak(t *testing.T) {
	t.Parallel()
	total, items := ComputeXP(true, false, 600, false, 5)
	want := XPWin + XPStreak5Bonus
	if total != want {
		t.Fatalf("expected %d, got %d", want, total)
	}
	// 2 items: win + streak (no fast, no first-try)
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
}

func TestComputeXP_Loss(t *testing.T) {
	t.Parallel()
	total, items := ComputeXP(false, false, 0, false, 0)
	if total != XPLoss {
		t.Fatalf("expected loss XP %d, got %d", XPLoss, total)
	}
	if items[0].Label != "За участие" {
		t.Fatalf("loss label mismatch: %s", items[0].Label)
	}
}

func TestComputeXP_Draw(t *testing.T) {
	t.Parallel()
	total, items := ComputeXP(false, true, 0, false, 0)
	if total != XPDraw {
		t.Fatalf("expected draw XP %d, got %d", XPDraw, total)
	}
	if items[0].Label != "Ничья" {
		t.Fatalf("draw label mismatch: %s", items[0].Label)
	}
}

func TestStreakLabel(t *testing.T) {
	t.Parallel()
	if got := StreakLabel(3); got != "" {
		t.Fatalf("expected empty for streak<5, got %q", got)
	}
	if got := StreakLabel(7); got != "7-WIN STREAK · +100 XP" {
		t.Fatalf("streak label mismatch: %s", got)
	}
}
