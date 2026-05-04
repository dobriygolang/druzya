package intelligence

import (
	"context"
	"fmt"
	"time"

	intelPorts "druz9/intelligence/ports"
	lsApp "druz9/learning_state/app"
	lsDomain "druz9/learning_state/domain"

	"github.com/google/uuid"
)

// learningStateAdapter — implements intelPorts.LearningStateMutator поверх
// learning_state.app UCs. Bootstrap'ом инжектируется в IntelligenceServer.
//
// Cross-service boundary: intelligence не импортирует learning_state
// напрямую (см. ports/server.go). Этот адаптер — единственная точка где
// два пакета встречаются — в monolith bootstrap, где это OK.
type learningStateAdapter struct {
	setMode *lsApp.SetMode
	setFork *lsApp.SetFork
	get     *lsApp.GetState
}

func (a *learningStateAdapter) SetMode(
	ctx context.Context,
	userID uuid.UUID,
	mode string,
	trackID *uuid.UUID,
) (intelPorts.LearningStateSnapshot, error) {
	state, err := a.setMode.Execute(ctx, lsApp.SetModeInput{
		UserID:  userID,
		Mode:    lsDomain.Mode(mode),
		TrackID: trackID,
	})
	if err != nil {
		return intelPorts.LearningStateSnapshot{}, fmt.Errorf("learningStateAdapter.SetMode: %w", err)
	}
	return toIntelSnapshot(state), nil
}

func (a *learningStateAdapter) SetFork(
	ctx context.Context,
	userID uuid.UUID,
	branch string,
) (intelPorts.LearningStateSnapshot, error) {
	var fb *lsDomain.ForkBranch
	if branch != "" {
		v := lsDomain.ForkBranch(branch)
		fb = &v
	}
	state, err := a.setFork.Execute(ctx, lsApp.SetForkInput{
		UserID: userID,
		Branch: fb,
	})
	if err != nil {
		return intelPorts.LearningStateSnapshot{}, fmt.Errorf("learningStateAdapter.SetFork: %w", err)
	}
	return toIntelSnapshot(state), nil
}

func toIntelSnapshot(s lsDomain.State) intelPorts.LearningStateSnapshot {
	out := intelPorts.LearningStateSnapshot{
		Mode: string(s.Mode),
	}
	if s.ForkBranch != nil {
		out.ForkBranch = string(*s.ForkBranch)
	}
	if s.CommittedTrackID != nil {
		out.CommittedTrackID = s.CommittedTrackID.String()
	}
	if s.Mode == lsDomain.ModeExplore && !s.ExploreStartedAt.IsZero() {
		weeks := int(time.Since(s.ExploreStartedAt).Hours()/(24*7)) + 1
		if weeks < 1 {
			weeks = 1
		}
		out.ExploreWeekIndex = weeks
	}
	return out
}
