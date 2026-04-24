package infra

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

type stubRatings struct{ rs []SectionRating }

func (s stubRatings) ListRatings(_ context.Context, _ uuid.UUID) ([]SectionRating, error) {
	return s.rs, nil
}

type stubAtlas struct{ ns []SkillNodeMastery }

func (s stubAtlas) ListUserSkillNodesWithSection(_ context.Context, _ uuid.UUID) ([]SkillNodeMastery, error) {
	return s.ns, nil
}

func TestUserSkillsResolver_Resolve(t *testing.T) {
	t.Parallel()

	uid := uuid.New()
	tcs := []struct {
		name         string
		ratings      []SectionRating
		nodes        []SkillNodeMastery
		wantSkill    []string
		wantNotSkill []string
		wantSection  []string
		wantConfMin  map[string]int // floor on confidence per skill
		wantEmpty    bool
	}{
		{
			name:      "no signal yields empty profile",
			wantEmpty: true,
		},
		{
			name: "go elo qualifies",
			ratings: []SectionRating{
				{Section: "go", Elo: 1200, MatchesCount: 25},
			},
			wantSkill:   []string{"go", "concurrency", "goroutines"},
			wantSection: []string{"go"},
			// elo/15 + matches*2 + 0 = 80 + 50 = 100 (clamped)
			wantConfMin: map[string]int{"go": 100, "concurrency": 100},
		},
		{
			name: "sql qualifies via elo, behavioral is filtered",
			ratings: []SectionRating{
				{Section: "sql", Elo: 1100, MatchesCount: 12},
				{Section: "behavioral", Elo: 1500, MatchesCount: 30},
			},
			wantSkill:   []string{"sql", "postgresql", "mysql", "rdbms", "queries", "database"},
			wantSection: []string{"behavioral", "sql"},
		},
		{
			name: "below thresholds — drops",
			ratings: []SectionRating{
				{Section: "go", Elo: 900, MatchesCount: 5},
			},
			wantEmpty: true,
		},
		{
			name: "atlas mastery qualifies even without elo",
			nodes: []SkillNodeMastery{
				{NodeKey: "n1", Section: "system_design", Progress: 100},
				{NodeKey: "n2", Section: "system_design", Progress: 100},
				{NodeKey: "n3", Section: "system_design", Progress: 100},
				{NodeKey: "n4", Section: "system_design", Progress: 100},
				{NodeKey: "n5", Section: "system_design", Progress: 100},
				{NodeKey: "n6", Section: "system_design", Progress: 50}, // below threshold, ignored
			},
			wantSkill:   []string{"system design", "microservices", "scalability"},
			wantSection: []string{"system_design"},
		},
		{
			name: "go normalizes golang, postgres → postgresql",
			ratings: []SectionRating{
				{Section: "sql", Elo: 1100, MatchesCount: 11},
			},
			// "postgres" raw label collapses into postgresql; ensure it's not duplicated.
			wantSkill:    []string{"postgresql"},
			wantNotSkill: []string{"postgres"},
		},
	}

	for _, tc := range tcs {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			r := NewUserSkillsResolver(stubRatings{rs: tc.ratings}, stubAtlas{ns: tc.nodes}, nil)
			got, err := r.Resolve(context.Background(), uid)
			if err != nil {
				t.Fatalf("Resolve: %v", err)
			}
			if tc.wantEmpty {
				if len(got.Skills) != 0 {
					t.Fatalf("want empty skills, got %v", got.Skills)
				}
				return
			}
			for _, s := range tc.wantSkill {
				if !hasString(got.Skills, s) {
					t.Errorf("want skill %q in %v", s, got.Skills)
				}
			}
			for _, s := range tc.wantNotSkill {
				if hasString(got.Skills, s) {
					t.Errorf("did NOT want skill %q in %v", s, got.Skills)
				}
			}
			for _, s := range tc.wantSection {
				if !hasString(got.Sections, s) {
					t.Errorf("want section %q in %v", s, got.Sections)
				}
			}
			for k, floor := range tc.wantConfMin {
				if got.Confidence[k] < floor {
					t.Errorf("confidence[%q]=%d < %d", k, got.Confidence[k], floor)
				}
			}
		})
	}
}

func hasString(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}
