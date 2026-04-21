package app

import (
	"context"
	"fmt"
	"log/slog"

	"druz9/ai_native/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Verify implements POST /api/v1/native/session/{id}/verify. The user records
// how they handled a previously-generated AI chunk: accepted / rejected /
// revised. This is the Verification Gate (bible §19.1).
type Verify struct {
	Sessions   domain.SessionRepo
	Provenance domain.ProvenanceRepo
	Scoring    domain.ScoringParams
	Log        *slog.Logger
}

// VerifyInput is the validated use-case payload.
type VerifyInput struct {
	UserID       uuid.UUID
	SessionID    uuid.UUID
	ProvenanceID uuid.UUID
	Action       domain.ActionKind
	Reason       string
	RevisedCode  string
}

// VerifyOutput returns the refreshed scores snapshot.
type VerifyOutput struct {
	Scores domain.Scores
}

// Do executes the use case.
func (uc *Verify) Do(ctx context.Context, in VerifyInput) (VerifyOutput, error) {
	if !in.Action.IsValid() {
		return VerifyOutput{}, fmt.Errorf("native.Verify: %w: invalid action %q", domain.ErrInvalidState, in.Action)
	}
	sess, err := uc.Sessions.Get(ctx, in.SessionID)
	if err != nil {
		return VerifyOutput{}, fmt.Errorf("native.Verify: get session: %w", err)
	}
	if sess.UserID != in.UserID {
		return VerifyOutput{}, fmt.Errorf("native.Verify: %w", domain.ErrForbidden)
	}
	if sess.IsFinished() {
		return VerifyOutput{}, fmt.Errorf("native.Verify: %w: session finished", domain.ErrInvalidState)
	}

	rec, err := uc.Provenance.Get(ctx, in.ProvenanceID)
	if err != nil {
		return VerifyOutput{}, fmt.Errorf("native.Verify: get provenance: %w", err)
	}
	if rec.SessionID != sess.ID {
		return VerifyOutput{}, fmt.Errorf("native.Verify: %w: provenance belongs to another session", domain.ErrForbidden)
	}

	newKind := mapActionToKind(in.Action)
	if mvErr := uc.Provenance.MarkVerified(ctx, rec.ID, newKind.String()); mvErr != nil {
		return VerifyOutput{}, fmt.Errorf("native.Verify: mark verified: %w", mvErr)
	}

	records, err := uc.Provenance.List(ctx, sess.ID)
	if err != nil {
		return VerifyOutput{}, fmt.Errorf("native.Verify: list: %w", err)
	}
	scoring := uc.Scoring
	if scoring.Cap == 0 {
		scoring = domain.DefaultScoring()
	}
	scores := domain.ComputeScores(records, actionsFromRecords(records), scoring)
	if err := uc.Sessions.UpdateScores(ctx, sess.ID, scores); err != nil {
		return VerifyOutput{}, fmt.Errorf("native.Verify: update scores: %w", err)
	}

	if uc.Log != nil {
		uc.Log.InfoContext(ctx, "native: verify",
			slog.String("session_id", sess.ID.String()),
			slog.String("provenance_id", rec.ID.String()),
			slog.String("action", string(in.Action)),
			slog.Bool("trap", rec.HasHallucinationTrap),
		)
	}
	return VerifyOutput{Scores: scores}, nil
}

// mapActionToKind translates a verify action into the provenance kind we
// persist. `accepted` leaves the record as ai_generated conceptually but we
// stamp verified_at via MarkVerified — so we keep the kind unchanged by
// mapping to the same ai_generated. Rejected → ai_rejected; Revised →
// ai_revised_by_human.
func mapActionToKind(a domain.ActionKind) enums.ProvenanceKind {
	switch a {
	case domain.ActionRejected:
		return enums.ProvenanceKindAIRejected
	case domain.ActionRevised:
		return enums.ProvenanceKindAIRevisedByHuman
	case domain.ActionAccepted:
		return enums.ProvenanceKindAIGenerated
	}
	return enums.ProvenanceKindAIGenerated
}
