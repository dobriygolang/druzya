package infra

import (
	"context"
	"fmt"

	ai_mockdb "druz9/ai_mock/infra/db"
	"druz9/shared/pkg/compaction"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SessionSummaryStore — адаптер поверх sqlc, реализует
// compaction.SummaryStore. sessionKey — строковое представление
// mock_sessions.id (UUID).
//
// Anti-fallback: parse errors и DB errors пробрасываются вверх; воркер
// логирует их и продолжает — drop-oldest уже обеспечен выше по стеку.
type SessionSummaryStore struct {
	q *ai_mockdb.Queries
}

// NewSessionSummaryStore оборачивает pool.
func NewSessionSummaryStore(pool *pgxpool.Pool) *SessionSummaryStore {
	return &SessionSummaryStore{q: ai_mockdb.New(pool)}
}

// Save атомарно записывает running_summary для mock session id.
func (s *SessionSummaryStore) Save(ctx context.Context, sessionKey, summary string) error {
	id, err := uuid.Parse(sessionKey)
	if err != nil {
		return fmt.Errorf("ai_mock.SessionSummaryStore.Save: parse session key: %w", err)
	}
	affected, err := s.q.UpdateMockSessionRunningSummary(ctx, ai_mockdb.UpdateMockSessionRunningSummaryParams{
		ID:             sharedpg.UUID(id),
		RunningSummary: summary,
	})
	if err != nil {
		return fmt.Errorf("ai_mock.SessionSummaryStore.Save: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("ai_mock.SessionSummaryStore.Save: session %s not found", id)
	}
	return nil
}

// Interface guard.
var _ compaction.SummaryStore = (*SessionSummaryStore)(nil)
