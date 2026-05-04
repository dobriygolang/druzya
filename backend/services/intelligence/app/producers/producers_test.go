package producers

import (
	"testing"
	"time"

	"druz9/intelligence/domain"
)

func TestFromForkProgress_SkipsWhenNotExplore(t *testing.T) {
	out := FromForkProgress(domain.ForkProgressSnapshot{Mode: "commit"}, time.Now())
	if len(out) != 0 {
		t.Fatalf("expected no insights for commit mode, got %d", len(out))
	}
}

func TestFromForkProgress_DELean(t *testing.T) {
	snap := domain.ForkProgressSnapshot{
		Mode:             "explore",
		ExploreWeekIndex: 3,
		ScoresByBranch: []domain.ForkBranchScore{
			{Branch: "mle", MockCount: 1, AvgScore: 60, VoluntaryDeepDives: 1},
			{Branch: "de", MockCount: 3, AvgScore: 75, VoluntaryDeepDives: 4},
		},
	}
	out := FromForkProgress(snap, time.Now())
	if len(out) != 1 {
		t.Fatalf("want 1 insight, got %d", len(out))
	}
	if out[0].Anchor[:5] != "fork:" || !contains(out[0].Headline, "de") {
		t.Fatalf("expected DE lean, got %+v", out[0])
	}
}

func TestFromForkProgress_NoSignal(t *testing.T) {
	snap := domain.ForkProgressSnapshot{
		Mode: "explore",
		ScoresByBranch: []domain.ForkBranchScore{
			{Branch: "mle"},
			{Branch: "de"},
		},
	}
	if got := FromForkProgress(snap, time.Now()); len(got) != 0 {
		t.Fatalf("zero scores → no insight; got %d", len(got))
	}
}

func TestFromResourceEngagement_OpenTabs(t *testing.T) {
	out := FromResourceEngagement(domain.ResourceEngagement{UnfinishedCount: 5}, time.Now())
	if len(out) != 1 || !contains(out[0].Headline, "Open tabs") {
		t.Fatalf("want Open tabs insight, got %+v", out)
	}
}

func TestFromResourceEngagement_NoReflectionTrigger(t *testing.T) {
	eng := domain.ResourceEngagement{
		FinishedRecent: []domain.ResourceTouch{
			{URL: "a"}, {URL: "b"}, {URL: "c"}, {URL: "d"},
		},
		RecentReflections: []domain.ResourceTouch{
			{URL: "a", Reflection: "x"},
		},
	}
	out := FromResourceEngagement(eng, time.Now())
	found := false
	for _, in := range out {
		if contains(in.Anchor, "no-reflection") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected no-reflection insight, got %+v", out)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
