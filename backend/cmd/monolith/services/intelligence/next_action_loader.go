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
// CalendarReader/UpcomingEvents was dropped alongside personal_events;
// coach next-action no longer factors interview-window pressure. Mocks
// + track step + fork mode remain the active inputs.
//
// focusReflections reader feeds the prompt with recent pomodoro
// grade+notes — direct lever for «previously stuck on X» rationale.
//
// mlProfile reader swaps default Go-senior framing for ML overlay when
// the user committed to the ML offer track (primary_goal=ml_offer) or
// is using Hone with active_track=ml.
type nextActionLoader struct {
	fork             *intelInfra.ForkProgressReader
	resourceTrail    *intelInfra.ResourceEngagementReader
	mocks            *intelInfra.MockReader
	tracks           *intelInfra.TrackReader
	focusReflections *intelInfra.FocusReflectionsPostgres
	mlProfile        *intelInfra.MLProfileReader
	// Wave 15: 24h activity counters (counts only).
	recentActivity *intelInfra.RecentActivityReader
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
				// reader.
			}
		}
	}
	_ = intelDomain.ActiveTrack{}

	// Recent focus reflections (last 14 days). Cap'нем cпеc'ом
	// 5 entries в prompt builder'е; reader возвращает up to 1000 чтобы
	// downstream Stats/Recall тоже мог использовать тот же snapshot.
	if l.focusReflections != nil {
		if refl, err := l.focusReflections.ListRecent(ctx, userID, 14); err == nil {
			// Cap at 10 to keep NextActionInput payload small. Prompt builder
			// дополнительно режет до 5.
			if len(refl) > 10 {
				refl = refl[:10]
			}
			out.RecentFocusReflections = refl
		}
	}

	// ML profile detection (primary_goal=ml_offer OR active_track=ml).
	// Reader is fail-soft (returns IsML=false on any error) so UC
	// деградирует к default-prompt'у gracefully.
	if l.mlProfile != nil {
		if profile, err := l.mlProfile.GetMLProfile(ctx, userID); err == nil {
			out.ML = profile
		}
	}

	// Wave 15: 24h activity snapshot — coach sees what user did recently.
	if l.recentActivity != nil {
		if snap, err := l.recentActivity.Last24h(ctx, userID); err == nil {
			out.RecentActivity24h = snap
		}
	}

	return out, nil
}
