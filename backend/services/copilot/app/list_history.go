// Package app contains the copilot use cases. Each handler is a thin
// orchestrator — persistence lives in infra/, rules in domain/.
package app

import (
	"context"
	"fmt"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// ListHistory implements GET /api/v1/copilot/history — returns past
// conversations for the authenticated user, newest first, with keyset
// pagination. Ownership is implicit via UserID — the repo query filters.
type ListHistory struct {
	Conversations domain.ConversationRepo
}

// ListHistoryInput validates caller intent.
type ListHistoryInput struct {
	UserID uuid.UUID
	Cursor domain.Cursor
	Limit  int
}

// ListHistoryOutput is the paged result.
type ListHistoryOutput struct {
	Conversations []domain.ConversationSummary
	NextCursor    domain.Cursor
}

// Do executes the use case.
func (uc *ListHistory) Do(ctx context.Context, in ListHistoryInput) (ListHistoryOutput, error) {
	items, next, err := uc.Conversations.ListForUser(ctx, in.UserID, in.Cursor, in.Limit)
	if err != nil {
		return ListHistoryOutput{}, fmt.Errorf("copilot.ListHistory: %w", err)
	}
	return ListHistoryOutput{Conversations: items, NextCursor: next}, nil
}
