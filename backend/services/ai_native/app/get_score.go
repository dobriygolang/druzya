package app

import (
	"context"
	"fmt"

	"druz9/ai_native/domain"

	"github.com/google/uuid"
)

// GetScore implements GET /api/v1/native/session/{id}/score. Returns the
// current four-axis snapshot for the session.
type GetScore struct {
	Sessions domain.SessionRepo
}

// GetScoreInput is the validated use-case payload.
type GetScoreInput struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
}

// GetScoreOutput is the snapshot.
type GetScoreOutput struct {
	Scores domain.Scores
}

// Do executes the use case.
func (uc *GetScore) Do(ctx context.Context, in GetScoreInput) (GetScoreOutput, error) {
	sess, err := uc.Sessions.Get(ctx, in.SessionID)
	if err != nil {
		return GetScoreOutput{}, fmt.Errorf("native.GetScore: get session: %w", err)
	}
	if sess.UserID != in.UserID {
		return GetScoreOutput{}, fmt.Errorf("native.GetScore: %w", domain.ErrForbidden)
	}
	return GetScoreOutput{Scores: sess.Scores}, nil
}
