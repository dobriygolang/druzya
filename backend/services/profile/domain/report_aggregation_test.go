package domain

import (
	"testing"

	"druz9/shared/enums"
)

func TestAggregateBySection_HappyPath(t *testing.T) {
	t.Parallel()
	in := []MatchAggregate{
		{Section: enums.SectionAlgorithms, Win: true, XPDelta: 120},
		{Section: enums.SectionAlgorithms, Win: true, XPDelta: 100},
		{Section: enums.SectionAlgorithms, Win: false, XPDelta: 20},
		{Section: enums.SectionSQL, Win: false, XPDelta: -50},
		{Section: enums.SectionSystemDesign, Win: true, XPDelta: 40},
	}
	strong, weak := AggregateBySection(in)
	if len(strong) != 2 {
		t.Fatalf("expected 2 strong sections, got %d", len(strong))
	}
	if strong[0].Section != enums.SectionAlgorithms {
		t.Fatalf("expected Algorithms first, got %s", strong[0].Section)
	}
	if strong[0].XPDelta != 240 {
		t.Fatalf("expected XP=240, got %d", strong[0].XPDelta)
	}
	if strong[0].WinRatePct != 66 {
		t.Fatalf("expected wr=66, got %d", strong[0].WinRatePct)
	}
	if len(weak) != 1 {
		t.Fatalf("expected 1 weak section, got %d", len(weak))
	}
	if weak[0].Section != enums.SectionSQL {
		t.Fatalf("expected SQL weak, got %s", weak[0].Section)
	}
	if weak[0].XPDelta != -50 {
		t.Fatalf("expected XP=-50, got %d", weak[0].XPDelta)
	}
}

func TestAggregateBySection_CapsAtThree(t *testing.T) {
	t.Parallel()
	in := []MatchAggregate{
		{Section: enums.SectionAlgorithms, Win: true, XPDelta: 100},
		{Section: enums.SectionSQL, Win: true, XPDelta: 80},
		{Section: enums.SectionGo, Win: true, XPDelta: 70},
		{Section: enums.SectionSystemDesign, Win: true, XPDelta: 60},
		{Section: enums.SectionBehavioral, Win: true, XPDelta: 50},
	}
	strong, _ := AggregateBySection(in)
	if len(strong) != 3 {
		t.Fatalf("expected cap=3, got %d", len(strong))
	}
}

func TestAggregateBySection_IgnoresInvalidSection(t *testing.T) {
	t.Parallel()
	in := []MatchAggregate{
		{Section: enums.Section("bogus"), Win: true, XPDelta: 100},
		{Section: enums.SectionAlgorithms, Win: true, XPDelta: 50},
	}
	strong, _ := AggregateBySection(in)
	if len(strong) != 1 {
		t.Fatalf("expected 1 valid, got %d", len(strong))
	}
}

func TestAggregateBySection_EmptyInput(t *testing.T) {
	t.Parallel()
	strong, weak := AggregateBySection(nil)
	if len(strong) != 0 || len(weak) != 0 {
		t.Fatalf("expected zero output for empty input")
	}
}

func TestBuildWeeklyComparison_NormalisesToHundred(t *testing.T) {
	t.Parallel()
	in := []int{2480, 1690, 2010, 1240}
	out := BuildWeeklyComparison(in)
	if len(out) != 4 {
		t.Fatalf("expected 4 weeks, got %d", len(out))
	}
	if out[0].Pct != 100 {
		t.Fatalf("expected first (max) pct=100, got %d", out[0].Pct)
	}
	if out[3].Pct != 50 {
		t.Fatalf("expected -3 pct=50 (1240/2480), got %d", out[3].Pct)
	}
	if out[0].Label != "Эта" {
		t.Fatalf("expected label Эта, got %q", out[0].Label)
	}
}

func TestBuildWeeklyComparison_AllZeros(t *testing.T) {
	t.Parallel()
	out := BuildWeeklyComparison([]int{0, 0, 0, 0})
	for i, w := range out {
		if w.Pct != 0 {
			t.Fatalf("week %d expected 0, got %d", i, w.Pct)
		}
	}
}

func TestBuildWeeklyComparison_PadShortInput(t *testing.T) {
	t.Parallel()
	out := BuildWeeklyComparison([]int{500})
	if len(out) != 4 {
		t.Fatalf("expected 4 weeks even for short input, got %d", len(out))
	}
	if out[0].XP != 500 {
		t.Fatalf("expected 500 for first week, got %d", out[0].XP)
	}
	if out[1].XP != 0 || out[2].XP != 0 || out[3].XP != 0 {
		t.Fatalf("expected zero-padded tail")
	}
}

func TestAggregateBySection_LossesCounted(t *testing.T) {
	t.Parallel()
	in := []MatchAggregate{
		{Section: enums.SectionAlgorithms, Win: false, XPDelta: -20},
		{Section: enums.SectionAlgorithms, Win: false, XPDelta: -30},
		{Section: enums.SectionAlgorithms, Win: true, XPDelta: 100},
	}
	strong, weak := AggregateBySection(in)
	// Net XP = 50, so it's strong.
	if len(strong) != 1 || len(weak) != 0 {
		t.Fatalf("expected 1 strong, 0 weak; got strong=%d weak=%d", len(strong), len(weak))
	}
	if strong[0].Losses != 2 || strong[0].Wins != 1 {
		t.Fatalf("losses/wins mismatch: %+v", strong[0])
	}
	if strong[0].WinRatePct != 33 {
		t.Fatalf("win-rate expected 33, got %d", strong[0].WinRatePct)
	}
}
