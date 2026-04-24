package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/cohort/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ContributeInput is the input shape for Contribute.Do.
type ContributeInput struct {
	CohortID uuid.UUID
	UserID   uuid.UUID
	Section  enums.Section
	Code     string
	Language enums.Language
}

// ContributeOutput is the immediate response: grading outcome + updated war
// view so the ports layer can return the tallied CohortWar without an extra
// round-trip.
type ContributeOutput struct {
	Passed      bool
	TestsTotal  int
	TestsPassed int
	Score       int
	WarView     WarView
}

// Contribute validates membership, grades via Judge0, persists the delta,
// updates the JSONB tally, and returns the refreshed war view.
//
// STUB: emits a LOCAL CohortWarLineScoreUpdated (there is no such shared event
// yet — we log it here so the subscriber story is obvious).
type Contribute struct {
	Cohorts domain.CohortRepo
	Wars    domain.WarRepo
	Judge0  domain.Judge0Client
	GetWar  *GetWar
	Clock   domain.Clock
	Log     *slog.Logger
}

// Do runs one contribution end-to-end.
func (uc *Contribute) Do(ctx context.Context, in ContributeInput) (ContributeOutput, error) {
	if len(in.Code) > domain.MaxCodeSizeBytes {
		return ContributeOutput{}, domain.ErrCodeTooLarge
	}
	if !in.Section.IsValid() {
		return ContributeOutput{}, domain.ErrInvalidSection
	}
	if !in.Language.IsValid() {
		return ContributeOutput{}, domain.ErrInvalidLanguage
	}

	// Load the member record — this both authorises the call and tells us
	// whether the user is assigned to a different section.
	member, err := uc.Cohorts.GetMember(ctx, in.CohortID, in.UserID)
	if err != nil {
		if errors.Is(err, domain.ErrNotMember) {
			return ContributeOutput{}, domain.ErrNotMember
		}
		return ContributeOutput{}, fmt.Errorf("cohort.Contribute: member: %w", err)
	}
	if member.CohortID != in.CohortID {
		return ContributeOutput{}, domain.ErrCohortMismatch
	}

	now := uc.clockNow()
	war, err := uc.Wars.GetCurrentWarForCohort(ctx, in.CohortID, now)
	if err != nil {
		return ContributeOutput{}, fmt.Errorf("cohort.Contribute: war: %w", err)
	}
	if canErr := domain.CanContribute(member, war, in.Section, now); canErr != nil {
		return ContributeOutput{}, fmt.Errorf("cohort.Contribute: %w", canErr)
	}

	side, ok := domain.SideForCohort(war, in.CohortID)
	if !ok {
		// Shouldn't happen — the current-war lookup used the cohort_id.
		return ContributeOutput{}, domain.ErrCohortMismatch
	}

	res, err := uc.Judge0.Submit(ctx, in.Code, string(in.Language), in.Section)
	if err != nil {
		return ContributeOutput{}, fmt.Errorf("cohort.Contribute: judge0: %w", err)
	}

	// Score policy: 10 points per passed test. Failed submissions score 0
	// but the contribution row is still recorded so analytics can see the
	// effort. Only successful passes update the tally so a spammy user
	// can't inflate the score by submitting junk.
	score := 10 * res.TestsPassed
	if !res.Passed {
		score = 0
	}

	contrib := domain.Contribution{
		WarID:    war.ID,
		Section:  in.Section,
		Side:     side,
		UserID:   member.UserID,
		Username: member.Username,
		Score:    score,
		AddedAt:  now,
	}
	if insErr := uc.Wars.InsertContribution(ctx, contrib); insErr != nil {
		return ContributeOutput{}, fmt.Errorf("cohort.Contribute: insert: %w", insErr)
	}
	if score > 0 {
		if upErr := uc.Wars.UpsertWarScore(ctx, war.ID, in.Section, side, score); upErr != nil {
			return ContributeOutput{}, fmt.Errorf("cohort.Contribute: upsert score: %w", upErr)
		}
		// STUB: emit a LOCAL cohort.WarLineScoreUpdated event — the shared
		// events.go does not define one yet. Logging here signals where the
		// subscribe point would land (WS broadcast / notifier).
		if uc.Log != nil {
			uc.Log.InfoContext(ctx, "cohort.WarLineScoreUpdated (local)",
				slog.String("war_id", war.ID.String()),
				slog.String("section", string(in.Section)),
				slog.String("side", string(side)),
				slog.Int("delta", score),
			)
		}
	}

	// Refresh view. We go through GetWar so the hydration logic stays in
	// one place (tallied lines, cohort names, etc.).
	view, err := uc.GetWar.Do(ctx, in.CohortID)
	if err != nil {
		return ContributeOutput{}, fmt.Errorf("cohort.Contribute: view: %w", err)
	}
	return ContributeOutput{
		Passed:      res.Passed,
		TestsTotal:  res.TestsTotal,
		TestsPassed: res.TestsPassed,
		Score:       score,
		WarView:     view,
	}, nil
}

func (uc *Contribute) clockNow() time.Time {
	if uc.Clock != nil {
		return uc.Clock.Now()
	}
	return time.Now().UTC()
}
