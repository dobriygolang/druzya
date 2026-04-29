package domain

import (
	"context"
	"time"
)

// CleanupRepo prunes tables that grow unbounded with active use.
//
// Each method runs one DELETE under its own (already-bounded) context and
// returns the affected row count. Errors are wrapped with the table name so
// the caller can log without losing structure.
type CleanupRepo interface {
	PruneNoteYjsUpdates(ctx context.Context, retention time.Duration) (int64, error)
	PruneWhiteboardYjsUpdates(ctx context.Context, retention time.Duration) (int64, error)
	PruneCopilotMessages(ctx context.Context, retention time.Duration) (int64, error)
	PrunePipelineAttempts(ctx context.Context, retention time.Duration) (int64, error)
}
