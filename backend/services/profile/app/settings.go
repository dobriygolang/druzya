package app

import (
	"context"
	"fmt"

	"druz9/profile/domain"

	"github.com/google/uuid"
)

// GetSettings reads the current settings row.
type GetSettings struct{ Repo domain.ProfileRepo }

// Do forwards to the repository.
func (uc *GetSettings) Do(ctx context.Context, userID uuid.UUID) (domain.Settings, error) {
	s, err := uc.Repo.GetSettings(ctx, userID)
	if err != nil {
		return domain.Settings{}, fmt.Errorf("profile.GetSettings: %w", err)
	}
	return s, nil
}

// UpdateSettings persists the settings block.
type UpdateSettings struct{ Repo domain.ProfileRepo }

// Do validates + persists.
func (uc *UpdateSettings) Do(ctx context.Context, userID uuid.UUID, s domain.Settings) (domain.Settings, error) {
	if s.Locale != "" && s.Locale != "ru" && s.Locale != "en" {
		return domain.Settings{}, fmt.Errorf("profile.UpdateSettings: invalid locale %q", s.Locale)
	}
	if s.DefaultLanguage != "" && !s.DefaultLanguage.IsValid() {
		return domain.Settings{}, fmt.Errorf("profile.UpdateSettings: invalid language %q", s.DefaultLanguage)
	}
	for _, ch := range s.Notifications.Channels {
		if !ch.IsValid() {
			return domain.Settings{}, fmt.Errorf("profile.UpdateSettings: invalid channel %q", ch)
		}
	}
	// Wave-10: focus_class is a closed set enforced by the DB CHECK in
	// migration 00035. Reject unknown values BEFORE the DB layer so the
	// caller gets a wrapped, structured error instead of a 500-from-CHECK.
	// Only validate when the caller explicitly sent the field — partial
	// updates that leave focus_class untouched are valid.
	if s.HasFocusClass {
		if _, ok := domain.AllowedFocusClasses[s.FocusClass]; !ok {
			return domain.Settings{}, fmt.Errorf("profile.UpdateSettings: invalid focus_class %q", s.FocusClass)
		}
	}
	if err := uc.Repo.UpdateSettings(ctx, userID, s); err != nil {
		return domain.Settings{}, fmt.Errorf("profile.UpdateSettings: %w", err)
	}
	// Re-read so the returned Settings reflects derived columns the write
	// path computes (notably onboarding_completed which the DB stamps with
	// NOW() on first true-write).
	out, err := uc.Repo.GetSettings(ctx, userID)
	if err != nil {
		return domain.Settings{}, fmt.Errorf("profile.UpdateSettings: re-read: %w", err)
	}
	return out, nil
}
