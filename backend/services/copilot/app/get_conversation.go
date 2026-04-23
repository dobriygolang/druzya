package app

import (
	"context"
	"fmt"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// GetConversation implements GET /api/v1/copilot/conversations/{id}.
// Returns the conversation header plus its ordered messages. Owner
// guard is enforced here — the repo Get is owner-agnostic.
type GetConversation struct {
	Conversations domain.ConversationRepo
	Messages      domain.MessageRepo
}

// GetConversationInput validates caller intent.
type GetConversationInput struct {
	UserID         uuid.UUID
	ConversationID uuid.UUID
}

// Do executes the use case.
func (uc *GetConversation) Do(ctx context.Context, in GetConversationInput) (domain.ConversationDetail, error) {
	conv, err := uc.Conversations.Get(ctx, in.ConversationID)
	if err != nil {
		return domain.ConversationDetail{}, fmt.Errorf("copilot.GetConversation: %w", err)
	}
	if conv.UserID != in.UserID {
		// Return NotFound instead of Forbidden so enumeration attacks can't
		// probe valid IDs belonging to other users.
		return domain.ConversationDetail{}, fmt.Errorf("copilot.GetConversation: %w", domain.ErrNotFound)
	}
	msgs, err := uc.Messages.List(ctx, conv.ID)
	if err != nil {
		return domain.ConversationDetail{}, fmt.Errorf("copilot.GetConversation: list messages: %w", err)
	}
	return domain.ConversationDetail{Conversation: conv, Messages: msgs}, nil
}
