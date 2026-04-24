package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/cohort/domain"

	"github.com/google/uuid"
)

// GetCohort returns the public view of a cohort (id-addressed).
type GetCohort struct {
	Cohorts domain.CohortRepo
	Wars    domain.WarRepo
	Clock   domain.Clock
}

// Do loads the cohort + members + current war id.
func (uc *GetCohort) Do(ctx context.Context, cohortID uuid.UUID) (domain.Cohort, error) {
	g, err := uc.Cohorts.GetCohort(ctx, cohortID)
	if err != nil {
		return domain.Cohort{}, fmt.Errorf("cohort.GetCohort: %w", err)
	}
	members, err := uc.Cohorts.ListCohortMembers(ctx, g.ID)
	if err != nil {
		return domain.Cohort{}, fmt.Errorf("cohort.GetCohort: members: %w", err)
	}
	g.Members = members
	if war, err := uc.Wars.GetCurrentWarForCohort(ctx, g.ID, uc.clockNow()); err == nil {
		id := war.ID
		g.CurrentWarID = &id
	} else if !errors.Is(err, domain.ErrNotFound) {
		return domain.Cohort{}, fmt.Errorf("cohort.GetCohort: war: %w", err)
	}
	return g, nil
}

func (uc *GetCohort) clockNow() time.Time {
	if uc.Clock != nil {
		return uc.Clock.Now()
	}
	return time.Now().UTC()
}
