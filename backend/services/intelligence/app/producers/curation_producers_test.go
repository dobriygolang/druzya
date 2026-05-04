package producers

import (
	"testing"
	"time"
)

func TestCoverageConfirmation_FiltersLowQuality(t *testing.T) {
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	events := []CoverageEvent{
		{AtlasNodeID: "ml", ResourceURL: "https://x", QualityScore: 0.5}, // below threshold
		{AtlasNodeID: "ml", ResourceURL: "https://y", QualityScore: 0.8},
	}
	out := FromCoverageConfirmation(events, now)
	if len(out) != 1 {
		t.Fatalf("expected 1 insight, got %d", len(out))
	}
	if out[0].DeepLink != "/atlas" {
		t.Errorf("deep link wrong: %s", out[0].DeepLink)
	}
}

func TestCoverageConfirmation_DeduplicatesByDay(t *testing.T) {
	now := time.Now().UTC()
	events := []CoverageEvent{
		{AtlasNodeID: "ml", ResourceURL: "a", QualityScore: 0.9},
		{AtlasNodeID: "ml", ResourceURL: "b", QualityScore: 0.95}, // same node + day
	}
	out := FromCoverageConfirmation(events, now)
	if len(out) != 1 {
		t.Errorf("expected dedup to 1, got %d", len(out))
	}
}

func TestGapDetection_NoGapsNoInsights(t *testing.T) {
	out := FromGapDetection(GapEvent{NextStep: "x", MissingNodes: nil}, time.Now())
	if len(out) != 0 {
		t.Errorf("expected 0 insights, got %d", len(out))
	}
}

func TestGapDetection_SingleMissingPrereq(t *testing.T) {
	out := FromGapDetection(GapEvent{
		NextStep: "ml_advanced", MissingNodes: []string{"ml_classical"},
	}, time.Now())
	if len(out) != 1 {
		t.Fatalf("expected 1 insight")
	}
	if !contains(out[0].Headline, "ml_classical") {
		t.Errorf("headline should mention missing node: %s", out[0].Headline)
	}
}

func TestRedundancySignal_RequiresThreshold(t *testing.T) {
	now := time.Now().UTC()
	clusters := []RedundancyCluster{
		{Topic: "ml", Resources: []string{"a", "b"}, AvgQuality: 0.9},      // <3 → skip
		{Topic: "de", Resources: []string{"a", "b", "c"}, AvgQuality: 0.7}, // quality<0.85 → skip
		{Topic: "go", Resources: []string{"a", "b", "c"}, AvgQuality: 0.9}, // pass
	}
	out := FromRedundancySignal(clusters, now)
	if len(out) != 1 {
		t.Errorf("expected 1 insight (only go), got %d", len(out))
	}
}

func TestConfusionPickup_QuotesText(t *testing.T) {
	now := time.Now().UTC()
	events := []ConfusionEvent{
		{UserID: "u1", AtlasNodeID: "ml", ResourceURL: "x",
			ConfusionText: "что такое gradient descent в детaлях"},
	}
	out := FromConfusionPickup(events, now)
	if len(out) != 1 {
		t.Fatalf("expected 1 insight")
	}
	if !contains(out[0].Headline, "gradient descent") {
		t.Errorf("headline should quote confusion: %s", out[0].Headline)
	}
}
