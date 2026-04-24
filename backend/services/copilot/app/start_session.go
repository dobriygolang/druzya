package app

import (
	"context"
	"fmt"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// StartSession — implements POST /api/v1/copilot/sessions. The
// single-live-session-per-user constraint is enforced by a partial
// unique index; we translate the unique violation into ErrLiveSessionExists
// so the client can react (usually: "end the previous one first").
type StartSession struct {
	Sessions domain.SessionRepo
}

type StartSessionInput struct {
	UserID uuid.UUID
	Kind   domain.SessionKind
}

func (uc *StartSession) Do(ctx context.Context, in StartSessionInput) (domain.Session, error) {
	if !in.Kind.IsValid() {
		return domain.Session{}, fmt.Errorf("copilot.StartSession: %w: kind=%q", domain.ErrInvalidInput, in.Kind)
	}
	s, err := uc.Sessions.Create(ctx, in.UserID, in.Kind)
	if err != nil {
		return domain.Session{}, fmt.Errorf("copilot.StartSession: %w", err)
	}
	return s, nil
}
