package infra

import (
	"context"
	"fmt"

	copilotdb "druz9/copilot/infra/db"
	"druz9/shared/pkg/compaction"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ConversationSummaryStore — тонкий адаптер поверх sqlc-генератов,
// реализующий compaction.SummaryStore. SessionKey кодируется как
// uuid.String() conversation_id; декодируется обратно в pgtype.UUID перед
// вызовом UpdateCopilotConversationRunningSummary.
//
// Anti-fallback: ошибки парсинга UUID и DB-ошибки пробрасываются вверх
// через %w — compaction.Worker просто логирует и продолжает.
type ConversationSummaryStore struct {
	q *copilotdb.Queries
}

// NewConversationSummaryStore — конструктор. Принимает pgxpool.Pool
// (не *Queries) ради симметрии с остальными adapter-конструкторами в
// этом пакете.
func NewConversationSummaryStore(pool *pgxpool.Pool) *ConversationSummaryStore {
	return &ConversationSummaryStore{q: copilotdb.New(pool)}
}

// Save атомарно записывает новый running_summary для conversation_id.
// sessionKey — строковое представление uuid.UUID (conversation_id).
func (s *ConversationSummaryStore) Save(ctx context.Context, sessionKey, summary string) error {
	id, err := uuid.Parse(sessionKey)
	if err != nil {
		return fmt.Errorf("copilot.ConversationSummaryStore.Save: parse session key: %w", err)
	}
	affected, err := s.q.UpdateCopilotConversationRunningSummary(ctx, copilotdb.UpdateCopilotConversationRunningSummaryParams{
		ID:             sharedpg.UUID(id),
		RunningSummary: summary,
	})
	if err != nil {
		return fmt.Errorf("copilot.ConversationSummaryStore.Save: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("copilot.ConversationSummaryStore.Save: conversation %s not found", id)
	}
	return nil
}

// Interface guard.
var _ compaction.SummaryStore = (*ConversationSummaryStore)(nil)
