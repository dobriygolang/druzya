package app

import (
	"context"
	"testing"

	"druz9/intelligence/domain"
	"druz9/intelligence/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestGetForkSnapshot_DERLeansHigher(t *testing.T) {
	ctrl := gomock.NewController(t)
	reader := mocks.NewMockForkProgressReader(ctrl)
	reader.EXPECT().Snapshot(gomock.Any(), gomock.Any()).Return(domain.ForkProgressSnapshot{
		Mode: "explore",
		ScoresByBranch: []domain.ForkBranchScore{
			{Branch: "mle", MockCount: 1, AvgScore: 60, VoluntaryDeepDives: 1},
			{Branch: "de", MockCount: 3, AvgScore: 75, VoluntaryDeepDives: 4},
		},
	}, nil)
	uc := GetForkSnapshot{Reader: reader}
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
	ctrl := gomock.NewController(t)
	reader := mocks.NewMockForkProgressReader(ctrl)
	reader.EXPECT().Snapshot(gomock.Any(), gomock.Any()).Return(domain.ForkProgressSnapshot{
		Mode: "explore",
		ScoresByBranch: []domain.ForkBranchScore{
			{Branch: "mle"},
			{Branch: "de"},
		},
	}, nil)
	uc := GetForkSnapshot{Reader: reader}
	out, err := uc.Do(context.Background(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if out.LeanBranch != "" || out.Confidence != 0 {
		t.Fatalf("expected empty lean, got %+v", out)
	}
}
