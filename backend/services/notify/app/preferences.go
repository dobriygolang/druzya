package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/notify/domain"

	"github.com/google/uuid"
)

// GetPreferences returns the user's row or defaults on missing.
type GetPreferences struct {
	Prefs domain.PreferencesRepo
	Log   *slog.Logger
}

// Do returns the user's preferences row (defaults if missing).
func (uc *GetPreferences) Do(ctx context.Context, userID uuid.UUID) (domain.Preferences, error) {
	p, err := uc.Prefs.Get(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			def := domain.DefaultPreferences()
			def.UserID = userID
			return def, nil
		}
		return domain.Preferences{}, fmt.Errorf("notify.GetPreferences: %w", err)
	}
	return p, nil
}

// UpdatePreferences validates channels and upserts the row.
type UpdatePreferences struct {
	Prefs domain.PreferencesRepo
	Log   *slog.Logger
}

// Do validates and persists the update.
func (uc *UpdatePreferences) Do(ctx context.Context, p domain.Preferences) (domain.Preferences, error) {
	if err := domain.ValidateChannels(p.Channels); err != nil {
		return domain.Preferences{}, fmt.Errorf("notify.UpdatePreferences: %w", err)
	}
	out, err := uc.Prefs.Upsert(ctx, p)
	if err != nil {
		return domain.Preferences{}, fmt.Errorf("notify.UpdatePreferences: %w", err)
	}
	return out, nil
}
