package app

import (
	"context"
	"fmt"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// Chat implements streaming Chat — a follow-up turn in an existing
// conversation. The streaming contract and downstream plumbing are shared
// with Analyze; Chat is a thin wrapper that enforces the "conversation id
// is required" precondition and picks the existing conversation's model
// unless the caller explicitly overrides it.
type Chat struct {
	Inner *Analyze
}

// ChatInput validates caller intent.
type ChatInput struct {
	UserID         uuid.UUID
	ConversationID uuid.UUID
	PromptText     string
	Attachments    []domain.AttachmentInput
	// Model is optional — empty means "reuse the conversation's model".
	Model  string
	Client domain.ClientContext
}

// Do dispatches into Analyze.
func (uc *Chat) Do(ctx context.Context, in ChatInput) (<-chan StreamFrame, error) {
	if in.ConversationID == uuid.Nil {
		return nil, fmt.Errorf("copilot.Chat: %w: conversation_id is required", domain.ErrInvalidInput)
	}
	model := in.Model
	if model == "" {
		conv, err := uc.Inner.Conversations.Get(ctx, in.ConversationID)
		if err != nil {
			return nil, fmt.Errorf("copilot.Chat: %w", err)
		}
		if conv.UserID != in.UserID {
			return nil, fmt.Errorf("copilot.Chat: %w", domain.ErrNotFound)
		}
		model = conv.Model
	}
	return uc.Inner.Do(ctx, AnalyzeInput{
		UserID:         in.UserID,
		ConversationID: in.ConversationID,
		PromptText:     in.PromptText,
		Model:          model,
		Attachments:    in.Attachments,
		Client:         in.Client,
	})
}
