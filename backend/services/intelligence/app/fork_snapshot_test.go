package app

import (
	"context"
	"testing"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

type fakeForkReader struct {
	snap domain.ForkProgressSnapshot
	err  error
}

func (f fakeForkReader) Snapshot(_ context.Context, _ uuid.UUID) (domain.ForkProgressSnapshot, error) {
	return f.snap, f.err
}

func TestGetForkSnapshot_DERLeansHigher(t *testing.T) {
	r := fakeForkReader{
		snap: domain.ForkProgressSnapshot{
			Mode: "explore",
			ScoresByBranch: []domain.ForkBranchScore{
				{Branch: "mle", MockCount: 1, AvgScore: 60, VoluntaryDeepDives: 1},
				{Branch: "de", MockCount: 3, AvgScore: 75, VoluntaryDeepDives: 4},
			},
		},
	}
	uc := GetForkSnapshot{Reader: r}
	out, err := uc.Do(context.Background(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if out.LeanBranch != "de" {
		t.Fatalf("want de lean, got %q (confidence %.2f)", out.LeanBranch, out.Confidence)
	}
	if out.Confidence <= 0 || out.Confidence >= 1 {
		t.Fatalf("confidence out of (0,1): %.2f", out.Confidence)
	}
	if len(out.Branches) != 2 {
		t.Fatalf("want 2 branch views, got %d", len(out.Branches))
	}
}

func TestGetForkSnapshot_NoSignal(t *testing.T) {
	r := fakeForkReader{snap: domain.ForkProgressSnapshot{
		Mode: "explore",
		ScoresByBranch: []domain.ForkBranchScore{
			{Branch: "mle"},
			{Branch: "de"},
		},
	}}
	uc := GetForkSnapshot{Reader: r}
	out, err := uc.Do(context.Background(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if out.LeanBranch != "" || out.Confidence != 0 {
		t.Fatalf("expected empty lean, got %+v", out)
	}
}
