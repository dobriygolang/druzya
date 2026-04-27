package app

import (
	"context"
	"fmt"
	"strings"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// SyncMemory validates ownership and writes compact Cue memory to the
// product-wide Coach memory sink.
type SyncMemory struct {
	Conversations domain.ConversationRepo
	Memory        domain.MemorySink
}

type SyncMemoryInput struct {
	UserID         uuid.UUID
	ConversationID uuid.UUID
	Memory         domain.ConversationMemory
}

func (uc *SyncMemory) Do(ctx context.Context, in SyncMemoryInput) error {
	if in.UserID == uuid.Nil || in.ConversationID == uuid.Nil {
		return fmt.Errorf("copilot.SyncMemory: %w: missing ids", domain.ErrInvalidInput)
	}
	if uc.Conversations == nil {
		return fmt.Errorf("copilot.SyncMemory: conversations repo is nil")
	}
	if uc.Memory == nil {
		return fmt.Errorf("copilot.SyncMemory: memory sink is nil")
	}
	if !in.Memory.Outcome.IsValid() {
		return fmt.Errorf("copilot.SyncMemory: %w: invalid outcome", domain.ErrInvalidInput)
	}
	if len(in.Memory.Turns) == 0 && strings.TrimSpace(in.Memory.RollingSummary) == "" {
		return fmt.Errorf("copilot.SyncMemory: %w: empty memory", domain.ErrInvalidInput)
	}

	conv, err := uc.Conversations.Get(ctx, in.ConversationID)
	if err != nil {
		return fmt.Errorf("copilot.SyncMemory: %w", err)
	}
	if conv.UserID != in.UserID {
		return fmt.Errorf("copilot.SyncMemory: %w", domain.ErrNotFound)
	}
	if err := uc.Memory.AppendConversationMemory(ctx, in.UserID, in.ConversationID, in.Memory); err != nil {
		return fmt.Errorf("copilot.SyncMemory: %w", err)
	}
	return nil
}
