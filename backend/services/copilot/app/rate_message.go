package app

import (
	"context"
	"fmt"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// RateMessage implements POST /api/v1/copilot/messages/{id}/rate.
//
// Ownership is enforced by a prefetch (OwnerOf → compare with caller UserID)
// instead of a JOIN update — sqlc can't express the join shape cleanly and
// the extra query cost is trivial at rating rates.
type RateMessage struct {
	Messages domain.MessageRepo
}

// RateMessageInput validates caller intent. Rating must be -1, 0, or +1.
type RateMessageInput struct {
	UserID    uuid.UUID
	MessageID uuid.UUID
	Rating    int8
}

// Do executes the use case.
func (uc *RateMessage) Do(ctx context.Context, in RateMessageInput) error {
	if in.Rating < -1 || in.Rating > 1 {
		return fmt.Errorf("copilot.RateMessage: %w: rating must be -1, 0, or +1", domain.ErrInvalidInput)
	}
	owner, err := uc.Messages.OwnerOf(ctx, in.MessageID)
	if err != nil {
		return fmt.Errorf("copilot.RateMessage: %w", err)
	}
	if owner != in.UserID {
		return fmt.Errorf("copilot.RateMessage: %w", domain.ErrNotFound)
	}
	if err := uc.Messages.Rate(ctx, in.MessageID, in.Rating); err != nil {
		return fmt.Errorf("copilot.RateMessage: %w", err)
	}
	return nil
}
