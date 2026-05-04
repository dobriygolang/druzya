// fork_snapshot.go — Phase 2 Coach fork-view (explore mode only).
//
// Тонкий wrapper над ForkProgressReader.Snapshot — добавляет deterministic
// confidence-derive (mirror'ит producers.computeFork) чтобы handler-слой
// не зависел от producers package, и форматирует под UI shape.
package app

import (
	"context"
	"fmt"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// GetForkSnapshot — UC для Coach fork view RPC.
type GetForkSnapshot struct {
	Reader domain.ForkProgressReader
}

// ForkSnapshotResult — UI-friendly shape. Handler конвертит в proto/JSON.
type ForkSnapshotResult struct {
	Mode             string
	ExploreWeekIndex int
	CurrentBranch    string
	Branches         []ForkBranchView
	LeanBranch       string
	Confidence       float64
}

// ForkBranchView — per-branch projection для UI bars.
type ForkBranchView struct {
	Branch             string
	MockCount          int
	AvgScore           float64
	VoluntaryDeepDives int
	// CompositeScore — derived (avg*count + 8/dive capped at 40).
	CompositeScore float64
}

// Do reads snapshot + computes deterministic confidence.
func (uc *GetForkSnapshot) Do(ctx context.Context, userID uuid.UUID) (ForkSnapshotResult, error) {
	snap, err := uc.Reader.Snapshot(ctx, userID)
	if err != nil {
		return ForkSnapshotResult{}, fmt.Errorf("intelligence.GetForkSnapshot: %w", err)
	}
	out := ForkSnapshotResult{
		Mode:             snap.Mode,
		ExploreWeekIndex: snap.ExploreWeekIndex,
		CurrentBranch:    snap.CurrentBranch,
	}
	for _, b := range snap.ScoresByBranch {
		out.Branches = append(out.Branches, ForkBranchView{
			Branch:             b.Branch,
			MockCount:          b.MockCount,
			AvgScore:           b.AvgScore,
			VoluntaryDeepDives: b.VoluntaryDeepDives,
			CompositeScore:     compositeScore(b),
		})
	}
	out.LeanBranch, out.Confidence = deriveLean(out.Branches)
	return out, nil
}

func compositeScore(b domain.ForkBranchScore) float64 {
	dives := float64(b.VoluntaryDeepDives) * 8
	if dives > 40 {
		dives = 40
	}
	return b.AvgScore*float64(b.MockCount) + dives
}

// deriveLean — same heuristic как в producers.computeFork. Дублируется
// чтобы UC не зависел от app/producers package (был бы circular).
func deriveLean(views []ForkBranchView) (string, float64) {
	if len(views) < 2 {
		return "", 0
	}
	hi, lo := views[0], views[1]
	if lo.CompositeScore > hi.CompositeScore {
		hi, lo = lo, hi
	}
	total := hi.CompositeScore + lo.CompositeScore
	if total == 0 {
		return "", 0
	}
	c := (hi.CompositeScore - lo.CompositeScore) / total
	if c < 0 {
		c = 0
	}
	if c > 1 {
		c = 1
	}
	return hi.Branch, c
}
