// Package app — install-state read use case.
//
// Returns the list of app surfaces the caller has heartbeat'd from.
// Cross-app banners on Hone/Cue/web read this to decide whether to show
// «install <other>» CTA.

package app

import (
	"context"
	"fmt"

	"druz9/profile/domain"

	"github.com/google/uuid"
)

// GetInstalledApps — read-side UC.
type GetInstalledApps struct {
	Repo domain.ProfileRepo
}

// Do returns the install matrix for one user, oldest-first.
func (uc *GetInstalledApps) Do(ctx context.Context, userID uuid.UUID) ([]domain.AppInstall, error) {
	items, err := uc.Repo.ListAppInstalls(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("profile.GetInstalledApps: %w", err)
	}
	return items, nil
}
