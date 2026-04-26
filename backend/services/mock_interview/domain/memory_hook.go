// memory_hook.go — narrow side-effect channel into the Coach memory.
//
// Mock-interview never imports the intelligence domain directly (the
// boundary stays hard); instead the bootstrap layer registers an
// adapter that implements this interface and forwards each event to
// intelApp.Memory.AppendAsync. Same pattern as hone/domain.MemoryHook.
//
// Methods MUST be cheap on the caller side — implementations push the
// write into a goroutine bound to a background ctx, so failures here
// never block a candidate's submit.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// MemoryHook is the optional Coach-memory tap. nil-safe — orchestrator
// guards every call.
type MemoryHook interface {
	// OnPipelineFinished is fired by FinishPipeline / CancelPipeline
	// after the verdict is persisted. Stages slice is the final list
	// (with scores + verdicts) so the adapter can build a useful
	// summary string for the AI Coach narrative.
	OnPipelineFinished(
		ctx context.Context,
		userID uuid.UUID,
		pipelineID uuid.UUID,
		verdict PipelineVerdict,
		totalScore *float32,
		stages []PipelineStage,
		occurredAt time.Time,
	)
}
