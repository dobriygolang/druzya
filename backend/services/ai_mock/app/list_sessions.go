package app

import (
	"context"
	"fmt"

	"druz9/ai_mock/domain"

	"github.com/google/uuid"
)

// ListSessions реализует GET /api/v1/mock/sessions — архив прошлых
// mock-сессий юзера. Это легковесный use-case: один прямой call к
// SessionRepo.ListByUser, без подтягивания messages / report. Frontend
// archive-страница рисует ровно карточки-summary, для full session/report
// идёт на GetSession/GetReport по конкретному id.
type ListSessions struct {
	Sessions domain.SessionRepo
}

// ListSessionsInput — параметры запроса. Пустые/zero значения трактуются
// server-side как defaults (limit=20, offset=0).
type ListSessionsInput struct {
	UserID uuid.UUID
	Limit  int
	Offset int
}

// ListSessionsResult — батч + полный total для UI пагинации.
type ListSessionsResult struct {
	Sessions []domain.Session
	Total    int
}

// Do возвращает страницу архива.
func (uc *ListSessions) Do(ctx context.Context, in ListSessionsInput) (ListSessionsResult, error) {
	if in.UserID == uuid.Nil {
		return ListSessionsResult{}, fmt.Errorf("mock.ListSessions: %w", domain.ErrForbidden)
	}
	limit, offset := clampPagination(in.Limit, in.Offset)
	sessions, total, err := uc.Sessions.ListByUser(ctx, in.UserID, limit, offset)
	if err != nil {
		return ListSessionsResult{}, fmt.Errorf("mock.ListSessions: %w", err)
	}
	return ListSessionsResult{Sessions: sessions, Total: total}, nil
}

// clampPagination defends the SQL layer against unbounded scans / negative
// offsets if a caller forgets to set or validate the request fields.
func clampPagination(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = 20
	} else if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}
