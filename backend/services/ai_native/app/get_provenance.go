package app

import (
	"context"
	"fmt"

	"druz9/ai_native/domain"

	"github.com/google/uuid"
)

// GetProvenance implements GET /api/v1/native/session/{id}/provenance. Returns
// the full provenance graph for a session, owned-by-caller gated.
type GetProvenance struct {
	Sessions   domain.SessionRepo
	Provenance domain.ProvenanceRepo
}

// GetProvenanceInput is the validated use-case payload.
type GetProvenanceInput struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
}

// GetProvenanceOutput is the hydrated list.
type GetProvenanceOutput struct {
	Records []domain.ProvenanceRecord
}

// Do executes the use case.
func (uc *GetProvenance) Do(ctx context.Context, in GetProvenanceInput) (GetProvenanceOutput, error) {
	sess, err := uc.Sessions.Get(ctx, in.SessionID)
	if err != nil {
		return GetProvenanceOutput{}, fmt.Errorf("native.GetProvenance: get session: %w", err)
	}
	if sess.UserID != in.UserID {
		return GetProvenanceOutput{}, fmt.Errorf("native.GetProvenance: %w", domain.ErrForbidden)
	}
	records, err := uc.Provenance.List(ctx, sess.ID)
	if err != nil {
		return GetProvenanceOutput{}, fmt.Errorf("native.GetProvenance: list: %w", err)
	}
	return GetProvenanceOutput{Records: records}, nil
}
