package app

import (
	"context"
	"fmt"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// DeleteConversation implements DELETE /api/v1/copilot/conversations/{id}.
// Cascades to messages via the FK ON DELETE CASCADE.
type DeleteConversation struct {
	Conversations domain.ConversationRepo
}

// DeleteConversationInput validates caller intent.
type DeleteConversationInput struct {
	UserID         uuid.UUID
	ConversationID uuid.UUID
}

// Do executes the use case. Returns ErrNotFound if the id is unknown or the
// caller is not the owner — indistinguishable by design to foil enumeration.
func (uc *DeleteConversation) Do(ctx context.Context, in DeleteConversationInput) error {
	if err := uc.Conversations.Delete(ctx, in.ConversationID, in.UserID); err != nil {
		return fmt.Errorf("copilot.DeleteConversation: %w", err)
	}
	return nil
}
