// list_cue_sessions.go — F10 read-side UC.
//
// Тонкий wrapper над InterviewSessionRepo.ListByUser с input нормализацией
// (limit 0 → 20, hard cap 100). Возвращает items + total для UI
// «Page X of Y» rendering.
package app

import (
	"context"
	"fmt"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// ListInterviewSessions UC.
type ListInterviewSessions struct {
	Repo domain.InterviewSessionRepo
}

// ListInterviewSessionsInput.
type ListInterviewSessionsInput struct {
	UserID uuid.UUID
	Limit  int
	Offset int
}

// ListInterviewSessionsResult.
type ListInterviewSessionsResult struct {
	Items []domain.InterviewSession
	Total int
}

// Do reads paginated list. Default limit = 20, hard cap = 100.
func (uc *ListInterviewSessions) Do(ctx context.Context, in ListInterviewSessionsInput) (ListInterviewSessionsResult, error) {
	if in.UserID == uuid.Nil {
		return ListInterviewSessionsResult{}, fmt.Errorf("intelligence.ListInterviewSessions: %w: zero user_id", domain.ErrInvalidInput)
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	offset := in.Offset
	if offset < 0 {
		offset = 0
	}
	items, total, err := uc.Repo.ListByUser(ctx, in.UserID, limit, offset)
	if err != nil {
		return ListInterviewSessionsResult{}, fmt.Errorf("intelligence.ListInterviewSessions: %w", err)
	}
	return ListInterviewSessionsResult{Items: items, Total: total}, nil
}
