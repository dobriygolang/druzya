package app

import (
	"context"
	"fmt"
	"log/slog"

	"druz9/profile/domain"
	sharedDomain "druz9/shared/domain"
)

// OnUserRegistered creates default rows (profile/subscription/ai_credits/notifs).
type OnUserRegistered struct {
	Repo domain.ProfileRepo
	Log  *slog.Logger
}

// Handle implements domain.Handler.
func (h *OnUserRegistered) Handle(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.UserRegistered)
	if !ok {
		return fmt.Errorf("profile.OnUserRegistered: unexpected event %T", ev)
	}
	if err := h.Repo.EnsureDefaults(ctx, e.UserID); err != nil {
		return fmt.Errorf("profile.OnUserRegistered: ensure defaults: %w", err)
	}
	h.Log.InfoContext(ctx, "profile: defaults created", slog.Any("user_id", e.UserID))
	return nil
}

// OnXPGained applies XP and publishes LevelUp if a threshold was crossed.
type OnXPGained struct {
	Repo domain.ProfileRepo
	Bus  sharedDomain.Bus
	Log  *slog.Logger
}

// Handle implements domain.Handler.
func (h *OnXPGained) Handle(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.XPGained)
	if !ok {
		return fmt.Errorf("profile.OnXPGained: unexpected event %T", ev)
	}
	bundle, err := h.Repo.GetByUserID(ctx, e.UserID)
	if err != nil {
		return fmt.Errorf("profile.OnXPGained: load profile: %w", err)
	}
	newLevel, oldLevel, remainder := domain.ApplyXP(bundle.Profile, e.Amount)
	if err := h.Repo.ApplyXPDelta(ctx, e.UserID, e.Amount, newLevel, remainder); err != nil {
		return fmt.Errorf("profile.OnXPGained: persist: %w", err)
	}
	if newLevel != oldLevel {
		if perr := h.Bus.Publish(ctx, sharedDomain.LevelUp{
			UserID:   e.UserID,
			LevelOld: oldLevel,
			LevelNew: newLevel,
		}); perr != nil {
			h.Log.WarnContext(ctx, "profile.OnXPGained: publish LevelUp", slog.Any("err", perr))
		}
	}
	return nil
}

// OnRatingChanged recomputes career_stage from the refreshed ratings set.
type OnRatingChanged struct {
	Repo domain.ProfileRepo
	Log  *slog.Logger
}

// Handle implements domain.Handler.
func (h *OnRatingChanged) Handle(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.RatingChanged)
	if !ok {
		return fmt.Errorf("profile.OnRatingChanged: unexpected event %T", ev)
	}
	ratings, err := h.Repo.ListRatings(ctx, e.UserID)
	if err != nil {
		return fmt.Errorf("profile.OnRatingChanged: list ratings: %w", err)
	}
	score := domain.GlobalPowerScore(ratings)
	stage := domain.CareerStageFromPowerScore(score)
	if !stage.IsValid() {
		return fmt.Errorf("profile.OnRatingChanged: invalid derived stage %q", stage)
	}
	if err := h.Repo.UpdateCareerStage(ctx, e.UserID, stage); err != nil {
		return fmt.Errorf("profile.OnRatingChanged: persist stage: %w", err)
	}
	return nil
}
