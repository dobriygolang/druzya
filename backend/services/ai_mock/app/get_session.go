package app

import (
	"context"
	"fmt"

	"druz9/ai_mock/domain"

	"github.com/google/uuid"
)

// GetSession implements GET /api/v1/mock/session/:id.
type GetSession struct {
	Sessions domain.SessionRepo
	Messages domain.MessageRepo
	Tasks    domain.TaskRepo

	// LastMessagesLimit bounds the last_messages array returned in the DTO.
	LastMessagesLimit int
}

// GetSessionResult carries the session plus the hydrated last-N messages and
// the (hint-stripped) task.
type GetSessionResult struct {
	Session      domain.Session
	Task         domain.TaskPublic
	LastMessages []domain.Message
}

// Do loads the session + last messages. The caller is responsible for verifying
// that in.UserID == session.UserID.
func (uc *GetSession) Do(ctx context.Context, userID, sessionID uuid.UUID) (GetSessionResult, error) {
	s, err := uc.Sessions.Get(ctx, sessionID)
	if err != nil {
		return GetSessionResult{}, fmt.Errorf("mock.GetSession: %w", err)
	}
	if s.UserID != userID {
		return GetSessionResult{}, fmt.Errorf("mock.GetSession: %w", domain.ErrForbidden)
	}

	limit := uc.LastMessagesLimit
	if limit <= 0 {
		limit = 20
	}
	msgs, err := uc.Messages.ListLast(ctx, sessionID, limit)
	if err != nil {
		return GetSessionResult{}, fmt.Errorf("mock.GetSession: list messages: %w", err)
	}

	// Hint-bearing task is fetched so we can still surface Title/Description to
	// the client — ToPublic drops the hint right here.
	task, err := uc.Tasks.GetWithHint(ctx, s.TaskID)
	if err != nil {
		return GetSessionResult{}, fmt.Errorf("mock.GetSession: task: %w", err)
	}

	return GetSessionResult{
		Session:      s,
		Task:         task.ToPublic(),
		LastMessages: msgs,
	}, nil
}
