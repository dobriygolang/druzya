package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/profile/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// BecomeInterviewer creates a pending interviewer application in the
// moderation queue. Idempotent — re-applying when an open application
// already exists returns the existing row.
//
// Approval flips users.role to `interviewer` (handled by ApproveInterviewer).
type BecomeInterviewer struct {
	Repo domain.ProfileRepo
}

func (uc *BecomeInterviewer) Do(ctx context.Context, userID uuid.UUID, motivation string) (domain.InterviewerApplication, error) {
	if uc.Repo == nil {
		return domain.InterviewerApplication{}, fmt.Errorf("profile.BecomeInterviewer: nil deps")
	}
	app, err := uc.Repo.SubmitInterviewerApplication(ctx, userID, motivation)
	if err != nil {
		return domain.InterviewerApplication{}, fmt.Errorf("profile.BecomeInterviewer: %w", err)
	}
	return app, nil
}

// GetMyInterviewerApplication is the read counterpart used by the /slots
// PromoCard to render the right CTA (apply / pending / rejected).
type GetMyInterviewerApplication struct {
	Repo domain.ProfileRepo
}

func (uc *GetMyInterviewerApplication) Do(ctx context.Context, userID uuid.UUID) (domain.InterviewerApplication, error) {
	app, err := uc.Repo.GetMyInterviewerApplication(ctx, userID)
	if err != nil {
		return domain.InterviewerApplication{}, fmt.Errorf("profile.GetMyInterviewerApplication: %w", err)
	}
	return app, nil
}

// ListInterviewerApplications — admin queue read.
type ListInterviewerApplications struct {
	Repo domain.ProfileRepo
}

func (uc *ListInterviewerApplications) Do(ctx context.Context, status string) ([]domain.InterviewerApplication, error) {
	out, err := uc.Repo.ListInterviewerApplications(ctx, status)
	if err != nil {
		return nil, fmt.Errorf("profile.ListInterviewerApplications: %w", err)
	}
	return out, nil
}

// ApproveInterviewerApplication marks the application approved AND flips
// the applicant's role to `interviewer`. Both writes happen in this use
// case (no DB transaction — small risk window where the role flips and
// the moderation row stays pending; we accept since both writes are
// idempotent and the queue worker can retry on partial failure).
type ApproveInterviewerApplication struct {
	Repo domain.ProfileRepo
}

func (uc *ApproveInterviewerApplication) Do(ctx context.Context, applicationID, adminID uuid.UUID, note string) (domain.InterviewerApplication, error) {
	app, err := uc.Repo.ApproveInterviewerApplication(ctx, applicationID, adminID, note)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.InterviewerApplication{}, fmt.Errorf("profile.ApproveInterviewerApplication: %w", err)
		}
		return domain.InterviewerApplication{}, fmt.Errorf("profile.ApproveInterviewerApplication: %w", err)
	}
	if err := uc.Repo.UpdateRole(ctx, app.UserID, string(enums.UserRoleInterviewer)); err != nil {
		return domain.InterviewerApplication{}, fmt.Errorf("profile.ApproveInterviewerApplication: promote: %w", err)
	}
	return app, nil
}

// RejectInterviewerApplication marks the application rejected with an
// optional moderator note. Does NOT touch users.role.
type RejectInterviewerApplication struct {
	Repo domain.ProfileRepo
}

func (uc *RejectInterviewerApplication) Do(ctx context.Context, applicationID, adminID uuid.UUID, note string) (domain.InterviewerApplication, error) {
	app, err := uc.Repo.RejectInterviewerApplication(ctx, applicationID, adminID, note)
	if err != nil {
		return domain.InterviewerApplication{}, fmt.Errorf("profile.RejectInterviewerApplication: %w", err)
	}
	return app, nil
}
