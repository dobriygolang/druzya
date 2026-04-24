package app

import (
	"context"
	"fmt"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

type ListSessions struct {
	Sessions domain.SessionRepo
}

type ListSessionsInput struct {
	UserID uuid.UUID
	Kind   domain.SessionKind // empty = all kinds
	Cursor domain.Cursor
	Limit  int
}

type ListSessionsOutput struct {
	Sessions   []domain.SessionSummary
	NextCursor domain.Cursor
}

func (uc *ListSessions) Do(ctx context.Context, in ListSessionsInput) (ListSessionsOutput, error) {
	items, next, err := uc.Sessions.ListForUser(ctx, in.UserID, in.Kind, in.Cursor, in.Limit)
	if err != nil {
		return ListSessionsOutput{}, fmt.Errorf("copilot.ListSessions: %w", err)
	}
	return ListSessionsOutput{Sessions: items, NextCursor: next}, nil
}
