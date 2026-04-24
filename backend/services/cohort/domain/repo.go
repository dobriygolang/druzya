//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// CohortRepo persists `cohorts` and `cohort_members`.
type CohortRepo interface {
	// UpsertCohort inserts or updates a cohort row.
	UpsertCohort(ctx context.Context, g Cohort) (Cohort, error)

	// GetCohort loads a cohort by id without members hydrated.
	GetCohort(ctx context.Context, id uuid.UUID) (Cohort, error)

	// GetMyCohort resolves the cohort the given user belongs to. Returns
	// ErrNotFound if the user has no cohort membership.
	GetMyCohort(ctx context.Context, userID uuid.UUID) (Cohort, error)

	// ListCohortMembers returns every member (joined with users.username).
	ListCohortMembers(ctx context.Context, cohortID uuid.UUID) ([]Member, error)

	// GetMember returns a single membership row, or ErrNotFound when missing.
	GetMember(ctx context.Context, cohortID, userID uuid.UUID) (Member, error)

	// ListTopCohorts returns the global cohort leaderboard ordered by cohort_elo
	// descending. The repo layer is responsible for the cap; callers should
	// rely on it rather than re-checking. Empty result set → empty slice +
	// nil error (NOT ErrNotFound — the leaderboard simply has zero rows).
	ListTopCohorts(ctx context.Context, limit int) ([]TopCohortSummary, error)
}

// WarRepo persists `cohort_wars` and the per-line JSONB score maps.
type WarRepo interface {
	// GetCurrentWarForCohort returns the war whose [week_start, week_end) covers
	// `now` for either side. Returns ErrNotFound when no such war exists.
	GetCurrentWarForCohort(ctx context.Context, cohortID uuid.UUID, now time.Time) (War, error)

	// GetWar loads a war row by its id.
	GetWar(ctx context.Context, warID uuid.UUID) (War, error)

	// UpsertWarScore records a score delta on (war, section, side) atomically.
	// Implementation: jsonb_set on scores_a / scores_b keyed by section.
	UpsertWarScore(ctx context.Context, warID uuid.UUID, section enums.Section, side Side, delta int) error

	// InsertContribution stores a single graded submission row. STUB: MVP keeps
	// contributions in an in-memory map because migration 00005 has no table.
	InsertContribution(ctx context.Context, c Contribution) error

	// ListContributions returns all contributions for a war, ordered newest
	// first. Used to hydrate the WarLine.Contributors list.
	ListContributions(ctx context.Context, warID uuid.UUID) ([]Contribution, error)

	// SetWinner marks the war as finished with the given winner (or nil for a
	// draw). Called by background sweeper at week-end.
	SetWinner(ctx context.Context, warID uuid.UUID, winner *uuid.UUID) error
}

// Judge0Client submits code for grading. Copied verbatim from the arena
// pattern so cohort doesn't cross-import the arena module.
//
// STUB: real Judge0 client. Lives in its own package once wired.
type Judge0Client interface {
	Submit(ctx context.Context, code, language string, section enums.Section) (Judge0Result, error)
}

// Judge0Result is the minimal grading outcome the cohort cares about.
type Judge0Result struct {
	Passed      bool
	TestsTotal  int
	TestsPassed int
	RuntimeMs   int
	MemoryKB    int
}
