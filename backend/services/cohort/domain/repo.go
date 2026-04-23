package domain

import (
	"context"

	"github.com/google/uuid"
)

// Repo is the persistence port for cohorts.
//
// STRATEGIC SCAFFOLD: implementation lands in `infra/postgres.go` against
// migration 00030_cohorts.sql.
type Repo interface {
	Create(ctx context.Context, c Cohort) (uuid.UUID, error)
	GetBySlug(ctx context.Context, slug string) (Cohort, error)
	Get(ctx context.Context, id uuid.UUID) (Cohort, error)

	AddMember(ctx context.Context, m CohortMember) error
	ListMembers(ctx context.Context, cohortID uuid.UUID) ([]CohortMember, error)
	RemoveMember(ctx context.Context, cohortID, userID uuid.UUID) error

	IssueInvite(ctx context.Context, inv CohortInvite) error
	ConsumeInvite(ctx context.Context, token string) (uuid.UUID, error)

	Leaderboard(ctx context.Context, cohortID uuid.UUID, weekISO string) ([]MemberStanding, error)
}
