package app

import (
	"context"
	"fmt"

	"druz9/profile/domain"

	"github.com/google/uuid"
)

// GetUserTracks returns the user's active track list, primary first.
type GetUserTracks struct {
	Repo domain.ProfileRepo
}

// Do reads from `user_tracks` via the repo. Empty result is a valid
// response — the caller renders the onboarding-fork.
func (uc *GetUserTracks) Do(ctx context.Context, userID uuid.UUID) ([]domain.UserTrack, error) {
	items, err := uc.Repo.ListUserTracks(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("profile.GetUserTracks: %w", err)
	}
	return items, nil
}

// SetUserTracks replaces the user's track list atomically. Validates the
// payload against domain invariants before touching the DB so 400 errors
// surface cleanly without a half-applied transaction.
type SetUserTracks struct {
	Repo domain.ProfileRepo
}

// Do enforces invariants then delegates to the repo. Returns the post-
// write list (with authoritative timestamps).
func (uc *SetUserTracks) Do(
	ctx context.Context,
	userID uuid.UUID,
	items []domain.UserTrack,
) ([]domain.UserTrack, error) {
	for i := range items {
		items[i].UserID = userID
	}
	if err := domain.ValidateTrackList(items); err != nil {
		return nil, fmt.Errorf("profile.SetUserTracks: %w", err)
	}
	out, err := uc.Repo.SetUserTracks(ctx, userID, items)
	if err != nil {
		return nil, fmt.Errorf("profile.SetUserTracks: %w", err)
	}
	return out, nil
}
