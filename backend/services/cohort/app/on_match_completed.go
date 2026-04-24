package app

import (
	"context"
	"fmt"
	"log/slog"

	"druz9/cohort/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// OnMatchCompleted reacts to arena.MatchCompleted. If the winner is a cohort
// member we bump the winning cohort's next-week seed so matchmaking pairs them
// against a tougher opponent (bible §3.5).
//
// STUB: the "seed bump" is logged only — a SeedBumpRepo adapter will land
// once the season domain owns next-week pairing.
type OnMatchCompleted struct {
	Cohorts domain.CohortRepo
	Log     *slog.Logger
}

// Apply handles one MatchCompleted event. The arena publishes the winner_id
// and loser_ids — we only care about the winner for seed bumps.
func (uc *OnMatchCompleted) Apply(ctx context.Context, winner uuid.UUID) error {
	g, err := uc.Cohorts.GetMyCohort(ctx, winner)
	if err != nil {
		// No cohort ⇒ nothing to do; swallow ErrNotFound.
		if err == domain.ErrNotFound {
			return nil
		}
		return fmt.Errorf("cohort.OnMatchCompleted: lookup cohort: %w", err)
	}
	// STUB: real implementation persists a +seed bump for the cohort's next
	// weekly matchmaking round. For now we just log it.
	if uc.Log != nil {
		uc.Log.InfoContext(ctx, "cohort.seedBump (STUB)",
			slog.String("cohort_id", g.ID.String()),
			slog.String("winner", winner.String()),
		)
	}
	return nil
}

// HandleMatchCompleted is the bus handler adapter (matches sharedDomain.Handler).
func (uc *OnMatchCompleted) HandleMatchCompleted(ctx context.Context, e sharedDomain.Event) error {
	ev, ok := e.(sharedDomain.MatchCompleted)
	if !ok {
		return fmt.Errorf("cohort.OnMatchCompleted: unexpected event type %T", e)
	}
	return uc.Apply(ctx, ev.WinnerID)
}
