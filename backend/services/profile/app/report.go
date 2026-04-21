package app

import (
	"context"
	"fmt"
	"time"

	"druz9/profile/domain"

	"github.com/google/uuid"
)

// ReportView is the weekly report shape passed to ports.
type ReportView struct {
	WeekStart       time.Time
	WeekEnd         time.Time
	Metrics         domain.Activity
	Heatmap         []int
	Strengths       []string
	Weaknesses      []ReportWeakness
	StressAnalysis  string
	Recommendations []Recommendation
}

// ReportWeakness is a node-scoped weak spot.
type ReportWeakness struct {
	AtlasNodeKey string
	Reason       string
}

// Recommendation mirrors openapi's Recommendation schema.
type Recommendation struct {
	Title       string
	Description string
	ActionKind  string
	Params      map[string]any
}

// GetReport is a STUB-heavy MVP implementation. It composes basic activity
// counts from real tables but leaves the AI-narrated fields as placeholders.
//
// STUB: LLM narrative generation — stress_analysis, strengths, weaknesses and
//
//	recommendations should come from an async job that consumes
//	arena_matches + mock_sessions + native_sessions over the last 7 days,
//	batches them, and asks the LLM to summarise. Wire once ai_mock/ai_native
//	services are ready.
type GetReport struct{ Repo domain.ProfileRepo }

// Do assembles the MVP report shape.
func (uc *GetReport) Do(ctx context.Context, userID uuid.UUID, now time.Time) (ReportView, error) {
	end := now.UTC().Truncate(24 * time.Hour)
	start := end.Add(-7 * 24 * time.Hour)
	metrics, err := uc.Repo.CountRecentActivity(ctx, userID, start)
	if err != nil {
		return ReportView{}, fmt.Errorf("profile.GetReport: activity: %w", err)
	}
	return ReportView{
		WeekStart: start,
		WeekEnd:   end,
		Metrics:   metrics,
		// STUB: LLM narrative generation — see comment on GetReport.
		Heatmap:        []int{0, 0, 0, 0, 0, 0, 0},
		Strengths:      []string{},
		Weaknesses:     []ReportWeakness{},
		StressAnalysis: "",
		Recommendations: []Recommendation{{
			Title:       "Open the Skill Atlas",
			Description: "Take a look at your weakest nodes and schedule a practice slot.",
			ActionKind:  "open_atlas",
		}},
	}, nil
}
