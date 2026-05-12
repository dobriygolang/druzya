// atlas_struggle_producer.go — Phase J Wave 3 / O (X5 cross-product handoff).
//
// Bridges mock_interview.Orchestrator's StruggleHook side-effect into
// intelligence.MarkAtlasStruggle. Same pattern as mockMemoryHook /
// memoryHook adapters in cmd/monolith/services/intelligence — keeps the
// mock_interview bounded context decoupled from intelligence/domain.
//
// Each call writes (or upserts) one row in user_atlas_struggle_marks
// with source='mock_stage'. The web AtlasPage reads via
// ListAtlasStruggles and renders a highlight overlay so the user sees
// where they're stuck without leaving the mock view.
//
// Calibration:
//   - confidence = 0.9 − axis_score (lower score = higher struggle)
//   - clamped to [0.5, 0.95] so a near-zero score doesn't pin to 1.0
//   - source = "mock_stage" (intelligence domain enum)
//   - note   = "Mock <stage>: weak axis score X.XX/1.0" (capped server-side)
//
// Fail-soft: errors are logged at Warn, never returned to FinishPipeline.
// The user's mock submit must not crash because struggle-tracking fell over.
package ai_mock

import (
	"context"
	"fmt"
	"log/slog"

	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	miDomain "druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// atlasStruggleProducer wraps the intelligence UC into the
// mock_interview port shape.
type atlasStruggleProducer struct {
	uc  *intelApp.MarkAtlasStruggle
	log *slog.Logger
}

// newAtlasStruggleProducer returns a nil-safe adapter. When uc is nil
// the resulting hook is also returned as nil so the orchestrator's
// `if o.Struggle == nil` guard short-circuits.
func newAtlasStruggleProducer(uc *intelApp.MarkAtlasStruggle, log *slog.Logger) miDomain.StruggleHook {
	if uc == nil {
		return nil
	}
	return &atlasStruggleProducer{uc: uc, log: log}
}

// Compile-time guard.
var _ miDomain.StruggleHook = (*atlasStruggleProducer)(nil)

// OnStageStruggle is fired by FinishPipeline. It builds the note text +
// calibrates confidence, then delegates to intelApp.MarkAtlasStruggle.
// Errors are logged at Warn level; the caller never sees them.
func (p *atlasStruggleProducer) OnStageStruggle(
	ctx context.Context,
	userID uuid.UUID,
	atlasNodeID string,
	stageKind miDomain.StageKind,
	axisScore float64,
	companyName string,
) {
	confidence := 0.9 - axisScore
	if confidence < 0.5 {
		confidence = 0.5
	}
	if confidence > 0.95 {
		confidence = 0.95
	}
	note := fmt.Sprintf("Mock %s: weak axis score %.2f/1.0", string(stageKind), axisScore)
	if companyName != "" {
		note = fmt.Sprintf("Mock %s (%s): weak axis score %.2f/1.0", string(stageKind), companyName, axisScore)
	}
	err := p.uc.Do(ctx, intelApp.MarkAtlasStruggleInput{
		UserID:      userID,
		AtlasNodeID: atlasNodeID,
		Source:      string(intelDomain.AtlasStruggleSourceMockStage),
		Confidence:  confidence,
		Note:        note,
	})
	if err != nil && p.log != nil {
		p.log.WarnContext(ctx, "mock_interview.atlas_struggle_producer: mark failed",
			slog.String("user_id", userID.String()),
			slog.String("atlas_node_id", atlasNodeID),
			slog.String("stage_kind", string(stageKind)),
			slog.Float64("axis_score", axisScore),
			slog.Any("err", err),
		)
	}
}
