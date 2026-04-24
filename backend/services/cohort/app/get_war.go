package app

import (
	"context"
	"fmt"
	"time"

	"druz9/cohort/domain"

	"github.com/google/uuid"
)

// WarView is the hydrated projection returned by GetWar. The ports layer
// converts it to the apigen.CohortWar DTO.
type WarView struct {
	War     domain.War
	CohortA domain.Cohort
	CohortB domain.Cohort
	Lines   []domain.WarLine
}

// GetWar returns the current war for a cohort plus its tallied lines.
type GetWar struct {
	Cohorts domain.CohortRepo
	Wars    domain.WarRepo
	Clock   domain.Clock
}

// Do loads the current war and expands it into the 5 WarLine view.
func (uc *GetWar) Do(ctx context.Context, cohortID uuid.UUID) (WarView, error) {
	war, err := uc.Wars.GetCurrentWarForCohort(ctx, cohortID, uc.clockNow())
	if err != nil {
		return WarView{}, fmt.Errorf("cohort.GetWar: %w", err)
	}
	a, err := uc.Cohorts.GetCohort(ctx, war.CohortAID)
	if err != nil {
		return WarView{}, fmt.Errorf("cohort.GetWar: cohort A: %w", err)
	}
	b, err := uc.Cohorts.GetCohort(ctx, war.CohortBID)
	if err != nil {
		return WarView{}, fmt.Errorf("cohort.GetWar: cohort B: %w", err)
	}
	contribs, err := uc.Wars.ListContributions(ctx, war.ID)
	if err != nil {
		return WarView{}, fmt.Errorf("cohort.GetWar: contribs: %w", err)
	}
	return WarView{
		War:     war,
		CohortA: a,
		CohortB: b,
		Lines:   domain.TallyLines(war, contribs),
	}, nil
}

func (uc *GetWar) clockNow() time.Time {
	if uc.Clock != nil {
		return uc.Clock.Now()
	}
	return time.Now().UTC()
}
