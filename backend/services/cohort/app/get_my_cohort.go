// Package app contains the cohort use cases. One file per endpoint / event
// subscription. Use cases never import infra and never touch the HTTP layer.
package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/cohort/domain"

	"github.com/google/uuid"
)

// GetMyCohort resolves the cohort the authenticated user belongs to together
// with the hydrated member list and the current-war id (nil if no war).
type GetMyCohort struct {
	Cohorts domain.CohortRepo
	Wars    domain.WarRepo
	Clock   domain.Clock
}

// Do returns the hydrated cohort view.
func (uc *GetMyCohort) Do(ctx context.Context, userID uuid.UUID) (domain.Cohort, error) {
	g, err := uc.Cohorts.GetMyCohort(ctx, userID)
	if err != nil {
		return domain.Cohort{}, fmt.Errorf("cohort.GetMyCohort: %w", err)
	}
	members, err := uc.Cohorts.ListCohortMembers(ctx, g.ID)
	if err != nil {
		return domain.Cohort{}, fmt.Errorf("cohort.GetMyCohort: members: %w", err)
	}
	g.Members = members
	if war, err := uc.Wars.GetCurrentWarForCohort(ctx, g.ID, uc.clockNow()); err == nil {
		id := war.ID
		g.CurrentWarID = &id
	} else if !errors.Is(err, domain.ErrNotFound) {
		return domain.Cohort{}, fmt.Errorf("cohort.GetMyCohort: war: %w", err)
	}
	return g, nil
}

func (uc *GetMyCohort) clockNow() time.Time {
	if uc.Clock != nil {
		return uc.Clock.Now()
	}
	return time.Now().UTC()
}
