package app

import (
	"context"
	"fmt"

	"druz9/cohort/domain"
)

// ListTopCohorts is the use case behind the GET /api/v1/cohorts/top REST
// endpoint. It exists alongside the four Connect-RPC use cases (GetMyCohort,
// GetCohort, GetWar, Contribute) — the contract was added without bumping the
// proto because the page that consumes it (top-cohorts for non-members) is
// purely a read-only convenience, and the cache layer covers the hot path.
type ListTopCohorts struct {
	Cohorts domain.CohortRepo
}

// Do clamps the requested limit and returns the leaderboard. The repository
// already enforces the same bounds; we duplicate them here so callers that
// bypass Postgres (e.g. tests with a memory repo) get the same shape.
func (uc *ListTopCohorts) Do(ctx context.Context, limit int) ([]domain.TopCohortSummary, error) {
	if limit <= 0 {
		limit = domain.DefaultTopCohortsLimit
	}
	if limit > domain.MaxTopCohortsLimit {
		limit = domain.MaxTopCohortsLimit
	}
	out, err := uc.Cohorts.ListTopCohorts(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("cohort.ListTopCohorts: %w", err)
	}
	return out, nil
}
