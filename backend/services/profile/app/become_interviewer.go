package app

import (
	"context"
	"fmt"

	"druz9/profile/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// BecomeInterviewer promotes the caller's role to `interviewer`.
//
// MVP semantics — instant self-service approval. The longer-term plan is
// admin moderation (a `pending_interviewer_apps` queue + admin sign-off);
// when that lands the use case stays the same but Do becomes "create
// pending application" and an AdminApprove use case flips the role.
type BecomeInterviewer struct {
	Repo    domain.ProfileRepo
	GetUC   *GetProfile
}

// Do is idempotent — calling it on an already-interviewer (or admin)
// returns the current ProfileView without touching the role column.
func (uc *BecomeInterviewer) Do(ctx context.Context, userID uuid.UUID) (ProfileView, error) {
	if uc.Repo == nil || uc.GetUC == nil {
		return ProfileView{}, fmt.Errorf("profile.BecomeInterviewer: nil deps")
	}
	if err := uc.Repo.UpdateRole(ctx, userID, string(enums.UserRoleInterviewer)); err != nil {
		return ProfileView{}, fmt.Errorf("profile.BecomeInterviewer: %w", err)
	}
	view, err := uc.GetUC.Do(ctx, userID)
	if err != nil {
		return ProfileView{}, fmt.Errorf("profile.BecomeInterviewer: refetch: %w", err)
	}
	return view, nil
}
