// get_node_coverage.go — R3 per-node coverage UC.
//
// Frontend (frontend/src/lib/atlasCoverage.ts) shipped fuzzy token-matching
// heuristic как localStorage MVP. Backend version aggregates user_resource_log
// rows by atlas_node_id (proper FK link) и возвращает State per node.
//
// State derivation mirrors frontend rules:
//   - covered:    matchCount30d ≥ 3
//   - partial:    matchCount30d ≥ 1 AND matchCount7d ≥ 1 (warm activity)
//   - struggling: matchCount30d ≥ 1 AND matchCount7d == 0 (cold) — есть signal но stale
//   - not_yet:    matchCount30d == 0
//
// «match» = finished + clicked + reflection_submitted (skipped/unhelpful
// исключены — это negative signals, не engagement).
package app

import (
	"context"
	"fmt"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// GetNodeCoverage UC.
type GetNodeCoverage struct {
	Reader domain.NodeCoverageReader
}

// GetNodeCoverageInput.
type GetNodeCoverageInput struct {
	UserID   uuid.UUID
	NodeKeys []string
}

// Do возвращает coverage per requested node key. Если node_keys пустой —
// возвращает empty slice (caller передал nothing to compute).
func (uc *GetNodeCoverage) Do(ctx context.Context, in GetNodeCoverageInput) ([]domain.NodeCoverage, error) {
	if in.UserID == uuid.Nil {
		return nil, fmt.Errorf("intelligence.GetNodeCoverage: %w: zero user_id", domain.ErrInvalidInput)
	}
	if len(in.NodeKeys) == 0 {
		return nil, nil
	}
	// Hard cap чтобы не дать клиенту запросить весь atlas.
	if len(in.NodeKeys) > 500 {
		in.NodeKeys = in.NodeKeys[:500]
	}
	return uc.Reader.CoverageForNodes(ctx, in.UserID, in.NodeKeys)
}

// DeriveCoverageState — pure helper mirror'ом frontend heuristic. Exported
// для использования reader'ами + tests.
func DeriveCoverageState(matchCount30d, matchCount7d int) domain.NodeCoverageState {
	switch {
	case matchCount30d >= 3:
		return domain.NodeCoverageCovered
	case matchCount30d >= 1 && matchCount7d >= 1:
		return domain.NodeCoveragePartial
	case matchCount30d >= 1:
		return domain.NodeCoverageStruggling
	default:
		return domain.NodeCoverageNotYet
	}
}
