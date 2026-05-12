// struggle_hook.go — Phase J Wave 3 / O (X5 cross-product handoff).
//
// Narrow side-effect channel from mock_interview into the intelligence
// atlas-struggle store. Same shape as MemoryHook — the orchestrator
// guards every call (nil-safe), and the adapter lives in the monolith
// boundary so this package never imports intelligence/domain.
//
// Triggered at FinishPipeline time: for every stage whose normalised
// axis-score < 0.4 (i.e. raw score < 40 on the 0-100 scale), the
// adapter writes a struggle mark with source='mock_stage' so the web
// AtlasPage highlights the matching node.
package domain

import (
	"context"

	"github.com/google/uuid"
)

// StruggleHook is the optional intelligence-side struggle reporter.
// nil-safe — orchestrator guards every call.
type StruggleHook interface {
	// OnStageStruggle is fired by FinishPipeline for each finished stage
	// whose axis-score crossed the struggle threshold. atlasNodeID is
	// the canonical anchor (`stage:algo` / `stage:sysdesign` / etc.).
	// axisScore is in [0,1] — the adapter calibrates confidence
	// (lower score = higher struggle confidence).
	OnStageStruggle(
		ctx context.Context,
		userID uuid.UUID,
		atlasNodeID string,
		stageKind StageKind,
		axisScore float64,
		companyName string,
	)
}
