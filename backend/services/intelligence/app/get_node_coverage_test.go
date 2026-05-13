package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/intelligence/domain"
	"druz9/intelligence/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestDeriveCoverageState(t *testing.T) {
	cases := []struct {
		c30, c7 int
		want    domain.NodeCoverageState
		name    string
	}{
		{0, 0, domain.NodeCoverageNotYet, "no events"},
		{1, 0, domain.NodeCoverageStruggling, "old single match"},
		{2, 0, domain.NodeCoverageStruggling, "old pair, no recent"},
		{1, 1, domain.NodeCoveragePartial, "fresh single match"},
		{2, 1, domain.NodeCoveragePartial, "fresh pair"},
		{3, 0, domain.NodeCoverageCovered, "three old"},
		{3, 3, domain.NodeCoverageCovered, "three fresh"},
		{10, 5, domain.NodeCoverageCovered, "heavy use"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := DeriveCoverageState(tc.c30, tc.c7)
			if got != tc.want {
				t.Fatalf("c30=%d c7=%d: want %q got %q", tc.c30, tc.c7, tc.want, got)
			}
		})
	}
}

func TestGetNodeCoverage_HappyPath(t *testing.T) {
	ctrl := gomock.NewController(t)
	reader := mocks.NewMockNodeCoverageReader(ctrl)
	reader.EXPECT().CoverageForNodes(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, keys []string) ([]domain.NodeCoverage, error) {
			seed := []domain.NodeCoverage{
				{NodeKey: "go.gc", State: domain.NodeCoverageCovered, MatchCount30d: 5, MatchCount7d: 2, LastMatchAt: time.Now()},
				{NodeKey: "ml.attention", State: domain.NodeCoveragePartial, MatchCount30d: 2, MatchCount7d: 1},
			}
			indexed := map[string]domain.NodeCoverage{}
			for _, c := range seed {
				indexed[c.NodeKey] = c
			}
			out := make([]domain.NodeCoverage, 0, len(keys))
			for _, k := range keys {
				if c, ok := indexed[k]; ok {
					out = append(out, c)
				} else {
					out = append(out, domain.NodeCoverage{NodeKey: k, State: domain.NodeCoverageNotYet})
				}
			}
			return out, nil
		},
	)
	uc := &GetNodeCoverage{Reader: reader}
	out, err := uc.Do(context.Background(), GetNodeCoverageInput{
		UserID:   uuid.New(),
		NodeKeys: []string{"go.gc", "ml.attention", "sd.consensus"},
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(out))
	}
	if out[2].State != domain.NodeCoverageNotYet {
		t.Fatalf("untouched node should be not_yet, got %s", out[2].State)
	}
}

func TestGetNodeCoverage_EmptyNodeKeysShortCircuits(t *testing.T) {
	ctrl := gomock.NewController(t)
	reader := mocks.NewMockNodeCoverageReader(ctrl)
	// No EXPECT — UC must short-circuit before calling the reader.
	uc := &GetNodeCoverage{Reader: reader}
	out, err := uc.Do(context.Background(), GetNodeCoverageInput{UserID: uuid.New()})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out != nil {
		t.Fatalf("expected nil result, got %+v", out)
	}
}

func TestGetNodeCoverage_RejectsZeroUser(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := &GetNodeCoverage{Reader: mocks.NewMockNodeCoverageReader(ctrl)}
	_, err := uc.Do(context.Background(), GetNodeCoverageInput{NodeKeys: []string{"x"}})
	if err == nil || !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestGetNodeCoverage_CapsAt500(t *testing.T) {
	ctrl := gomock.NewController(t)
	called := 0
	reader := mocks.NewMockNodeCoverageReader(ctrl)
	reader.EXPECT().CoverageForNodes(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, keys []string) ([]domain.NodeCoverage, error) {
			called = len(keys)
			return nil, nil
		},
	)
	uc := &GetNodeCoverage{Reader: reader}
	bigKeys := make([]string, 1000)
	for i := range bigKeys {
		bigKeys[i] = "k"
	}
	_, _ = uc.Do(context.Background(), GetNodeCoverageInput{
		UserID:   uuid.New(),
		NodeKeys: bigKeys,
	})
	if called > 500 {
		t.Fatalf("expected cap at 500 keys, got %d", called)
	}
}
