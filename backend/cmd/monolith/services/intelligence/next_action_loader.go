package intelligence

import (
	"context"

	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	intelInfra "druz9/intelligence/infra"

	"github.com/google/uuid"
)

// nextActionLoader собирает NextActionInput для GetNextAction UC. Тонкая
// аггрегация поверх existing intelligence-readers + ForkProgressReader +
// ResourceEngagementReader. Помещаем в bootstrap-слой чтобы UC не
// импортировал readers напрямую (DI через ports interface).
//
// Calendar pivot 2026-05-04: CalendarReader/UpcomingEvents removed alongside
// personal_events drop. Coach next-action no longer factors interview-window
// pressure; mocks + track step + fork mode remain the active inputs.
type nextActionLoader struct {
	fork          *intelInfra.ForkProgressReader
	resourceTrail *intelInfra.ResourceEngagementReader
	mocks         *intelInfra.MockReader
	tracks        *intelInfra.TrackReader
}

// LoadNextActionContext implements intelPorts.NextActionContextLoader.
func (l *nextActionLoader) LoadNextActionContext(
	ctx context.Context,
	userID uuid.UUID,
) (intelApp.NextActionInput, error) {
	out := intelApp.NextActionInput{UserID: userID}

	// Fork snapshot (включает mode + week + branches).
	if snap, err := l.fork.Snapshot(ctx, userID); err == nil {
		out.Fork = snap
		out.LearningState = intelApp.LearningStateView{
			Mode:             snap.Mode,
			ForkBranch:       snap.CurrentBranch,
			ExploreWeekIndex: snap.ExploreWeekIndex,
		}
	}

	// Resource trail (last 7 days, 5 keepRecent).
	if trail, err := l.resourceTrail.EngagementWindow(ctx, userID, 7, 5); err == nil {
		out.ResourceTrail = trail
	}

	// Recent mocks (last 5 finished).
	if mocks, err := l.mocks.LastNFinished(ctx, userID, 5); err == nil {
		out.RecentMocks = mocks
	}

	// ActiveTrack — first non-paused enrolment (для users в commit/deep mode).
	// Coach hero суетится в этом step'е чтобы next-action был step-aware.
	if l.tracks != nil {
		if tracks, err := l.tracks.ActiveTracks(ctx, userID); err == nil && len(tracks) > 0 {
			t := tracks[0]
			out.ActiveTrack = &intelApp.ActiveTrackStep{
				TrackSlug: t.Slug,
				StepIndex: t.CurrentStep,
				StepTitle: t.CurrentStepTitle,
				SkillKeys: t.CurrentStepSkills,
				// CheckpointKeys требует tracks-domain reader — отложен,
				// будет проброшен из tracks-bootstrap или через отдельный
				// reader в Phase 2 UI handler scope.
			}
		}
	}
	_ = intelDomain.ActiveTrack{}

	return out, nil
}
