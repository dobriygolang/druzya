// canvas_drafts.go — orchestrator-adjacent use cases for the Redis
// fallback draft store. The store itself is a dumb adapter; ownership
// + lifecycle checks live here.
//
// Frontend invariant: a draft is only valid for an attempt whose
// pipeline is still in_progress AND whose ai_verdict is still pending.
// Once the user clicks Submit (verdict transitions away from pending),
// the canonical record lives in pipeline_attempts and the draft is
// stale — Get returns ErrNotFound so the UI doesn't accidentally
// rewind a finished diagram.

package app

import (
	"context"
	"fmt"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// SaveCanvasDraftInput — sole payload for Orchestrator.SaveCanvasDraft.
type SaveCanvasDraftInput struct {
	AttemptID       uuid.UUID
	UserID          uuid.UUID
	SceneJSON       []byte
	NonFunctionalMD string
	ContextMD       string
}

// SaveCanvasDraft persists the in-flight diagram. Validates ownership
// + that the attempt is a non-finalised sysdesign-canvas. Returns
// domain sentinels (ErrNotFound, ErrConflict, ErrValidation) so ports
// can map them via errToHTTP.
func (o *Orchestrator) SaveCanvasDraft(ctx context.Context, in SaveCanvasDraftInput) error {
	if o.CanvasDrafts == nil {
		return fmt.Errorf("canvas drafts: store not configured: %w", domain.ErrNotFound)
	}
	if err := o.assertCanvasDraftOwnership(ctx, in.AttemptID, in.UserID, false); err != nil {
		return err
	}
	return o.CanvasDrafts.Save(ctx, in.AttemptID, domain.CanvasDraft{
		SceneJSON:       in.SceneJSON,
		NonFunctionalMD: in.NonFunctionalMD,
		ContextMD:       in.ContextMD,
		UpdatedAt:       o.now(),
	})
}

// GetCanvasDraft reads back the latest draft for an attempt. Returns
// ErrNotFound if either the attempt is already submitted (verdict !=
// pending) or no draft was ever written.
func (o *Orchestrator) GetCanvasDraft(ctx context.Context, attemptID, userID uuid.UUID) (domain.CanvasDraft, error) {
	if o.CanvasDrafts == nil {
		return domain.CanvasDraft{}, fmt.Errorf("canvas drafts: store not configured: %w", domain.ErrNotFound)
	}
	if err := o.assertCanvasDraftOwnership(ctx, attemptID, userID, true); err != nil {
		return domain.CanvasDraft{}, err
	}
	return o.CanvasDrafts.Get(ctx, attemptID)
}

// DeleteCanvasDraft is the explicit user-driven wipe (e.g. "I'm
// starting over"). Cleanup on Submit / Finish / Cancel goes through
// the orchestrator's internal helpers, not this method.
func (o *Orchestrator) DeleteCanvasDraft(ctx context.Context, attemptID, userID uuid.UUID) error {
	if o.CanvasDrafts == nil {
		return nil
	}
	if err := o.assertCanvasDraftOwnership(ctx, attemptID, userID, true); err != nil {
		return err
	}
	return o.CanvasDrafts.Delete(ctx, attemptID)
}

// assertCanvasDraftOwnership verifies the attempt is a sysdesign-canvas
// belonging to the caller. When `allowSubmitted` is false the check
// also rejects attempts whose verdict has settled — saving a draft on
// top of a judged attempt would silently overwrite the canonical row's
// "scratch space" representation.
func (o *Orchestrator) assertCanvasDraftOwnership(
	ctx context.Context, attemptID, userID uuid.UUID, allowSubmitted bool,
) error {
	att, err := o.Attempts.Get(ctx, attemptID)
	if err != nil {
		return fmt.Errorf("attempts.Get: %w", err)
	}
	if att.Kind != domain.AttemptSysDesignCanvas {
		return fmt.Errorf("attempt is not sysdesign canvas: %w", domain.ErrConflict)
	}
	stage, err := o.PipelineStages.Get(ctx, att.PipelineStageID)
	if err != nil {
		return fmt.Errorf("pipelineStages.Get: %w", err)
	}
	pipe, err := o.Pipelines.Get(ctx, stage.PipelineID)
	if err != nil {
		return fmt.Errorf("pipelines.Get: %w", err)
	}
	if pipe.UserID != userID {
		// Hide existence — same convention as ports.Get.
		return fmt.Errorf("not owner: %w", domain.ErrNotFound)
	}
	if !allowSubmitted && att.AIVerdict != domain.AttemptVerdictPending {
		return fmt.Errorf("attempt already finalised (verdict=%s): %w", att.AIVerdict, domain.ErrConflict)
	}
	return nil
}
