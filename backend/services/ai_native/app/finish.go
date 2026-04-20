package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/ai_native/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// Finish implements the "complete this AI-Native Round" transition.
//
// The openapi contract doesn't expose a dedicated /finish endpoint for ai_native
// (bible §19.1 lets the frontend call this implicitly after delivery), but we
// keep a standalone use case so wiring can bind it to either a dedicated route
// or an internal scheduler.
//
// Invariants:
//   - Verification Gate: at least one provenance record must have verified_at
//     set, otherwise ErrInvalidState is returned.
//   - Idempotency: calling Do on an already-finished session returns its
//     current snapshot without re-emitting the event.
type Finish struct {
	Sessions   domain.SessionRepo
	Provenance domain.ProvenanceRepo
	Bus        sharedDomain.Bus
	Scoring    domain.ScoringParams
	Log        *slog.Logger
	Now        func() time.Time
}

// FinishInput is the validated use-case payload.
type FinishInput struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
}

// FinishOutput bundles the finished session + final scores.
type FinishOutput struct {
	Session domain.Session
	Scores  domain.Scores
}

// Do executes the use case.
func (uc *Finish) Do(ctx context.Context, in FinishInput) (FinishOutput, error) {
	sess, err := uc.Sessions.Get(ctx, in.SessionID)
	if err != nil {
		return FinishOutput{}, fmt.Errorf("native.Finish: get session: %w", err)
	}
	if sess.UserID != in.UserID {
		return FinishOutput{}, fmt.Errorf("native.Finish: %w", domain.ErrForbidden)
	}
	if sess.IsFinished() {
		return FinishOutput{Session: sess, Scores: sess.Scores}, nil
	}

	records, err := uc.Provenance.List(ctx, sess.ID)
	if err != nil {
		return FinishOutput{}, fmt.Errorf("native.Finish: list: %w", err)
	}
	if err := domain.ValidateVerificationGate(records); err != nil {
		return FinishOutput{}, fmt.Errorf("native.Finish: %w", err)
	}

	scoring := uc.Scoring
	if scoring.Cap == 0 {
		scoring = domain.DefaultScoring()
	}
	scores := domain.ComputeScores(records, actionsFromRecords(records), scoring)

	if err := uc.Sessions.MarkFinished(ctx, sess.ID, scores); err != nil {
		return FinishOutput{}, fmt.Errorf("native.Finish: mark finished: %w", err)
	}
	// Re-fetch to get the stamped finished_at.
	sess, err = uc.Sessions.Get(ctx, sess.ID)
	if err != nil {
		return FinishOutput{}, fmt.Errorf("native.Finish: refetch: %w", err)
	}

	if uc.Bus != nil {
		ev := sharedDomain.NativeRoundFinished{
			SessionID: sess.ID,
			UserID:    sess.UserID,
			Section:   sess.Section,
		}
		ev.Scores.Context = scores.Context
		ev.Scores.Verification = scores.Verification
		ev.Scores.Judgment = scores.Judgment
		ev.Scores.Delivery = scores.Delivery
		if err := uc.Bus.Publish(ctx, ev); err != nil && uc.Log != nil {
			uc.Log.WarnContext(ctx, "native.Finish: publish event", slog.Any("err", err))
		}
	}
	return FinishOutput{Session: sess, Scores: scores}, nil
}

func (uc *Finish) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}

var _ = (*Finish)(nil).now // keep helper available
