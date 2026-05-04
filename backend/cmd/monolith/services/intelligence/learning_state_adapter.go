package intelligence

import (
	"context"
	"fmt"
	"time"

	intelPorts "druz9/intelligence/ports"
	lsApp "druz9/learning_state/app"
	lsDomain "druz9/learning_state/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
	// pool — для auto-pick первого enrolled track когда commit/deep без
	// явного trackID (Sergey 2026-05-05: «нажал commit — само возьми
	// текущий track из user_tracks»).
	pool poolForAdapter
}

// poolForAdapter — narrow shim над *pgxpool.Pool. Bootstrap прокидывает
// d.Pool (concrete type) — *pgxpool.Pool implementing this interface.
type poolForAdapter interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (a *learningStateAdapter) SetMode(
	ctx context.Context,
	userID uuid.UUID,
	mode string,
	trackID *uuid.UUID,
) (intelPorts.LearningStateSnapshot, error) {
	// Auto-pick first enrolled track для commit/deep when frontend не sends
	// trackID. UX: юзер enrolled на 1 track при онбординге → нажатие
	// commit/deep should just work, no «pick track first» friction.
	if (mode == "commit" || mode == "deep") && trackID == nil && a.pool != nil {
		var picked uuid.UUID
		err := a.pool.QueryRow(ctx,
			`SELECT track_id FROM user_tracks WHERE user_id=$1
			 ORDER BY joined_at DESC LIMIT 1`, userID,
		).Scan(&picked)
		if err == nil {
			trackID = &picked
		}
	}
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
