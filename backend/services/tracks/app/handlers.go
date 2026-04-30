// Package app — tracks use cases.
//
// Pure orchestrators around the two repos. Each verb is one struct;
// validation lives at the use-case layer so the port stays a thin
// proto-translator. The "Join" verb is the only one with non-trivial
// branching: when the user is already enrolled and paused, Join
// becomes a Resume.
package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/tracks/domain"

	"github.com/google/uuid"
)

// ListCatalog — public read of the curated catalogue.
type ListCatalog struct {
	Catalog domain.CatalogRepo
}

// Do executes the use case.
func (uc *ListCatalog) Do(ctx context.Context) ([]domain.Track, error) {
	rows, err := uc.Catalog.ListActive(ctx)
	if err != nil {
		return nil, fmt.Errorf("tracks.ListCatalog: %w", err)
	}
	return rows, nil
}

// GetTrack — single track + ordered steps for the detail page.
type GetTrack struct {
	Catalog domain.CatalogRepo
}

// Do executes the use case.
func (uc *GetTrack) Do(ctx context.Context, slug string) (domain.TrackWithSteps, error) {
	slug = strings.TrimSpace(strings.ToLower(slug))
	if slug == "" {
		return domain.TrackWithSteps{}, fmt.Errorf("tracks.GetTrack: %w: empty slug", domain.ErrInvalidInput)
	}
	out, err := uc.Catalog.GetBySlug(ctx, slug)
	if err != nil {
		return domain.TrackWithSteps{}, fmt.Errorf("tracks.GetTrack: %w", err)
	}
	return out, nil
}

// ListUserTracks — enrolment list for the current user.
type ListUserTracks struct {
	Members domain.MembershipRepo
}

// Do executes the use case.
func (uc *ListUserTracks) Do(ctx context.Context, userID uuid.UUID) ([]domain.UserTrackProgress, error) {
	if userID == uuid.Nil {
		return nil, fmt.Errorf("tracks.ListUserTracks: %w: nil user_id", domain.ErrInvalidInput)
	}
	rows, err := uc.Members.ListByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("tracks.ListUserTracks: %w", err)
	}
	return rows, nil
}

// JoinTrack — enrol or resume.
type JoinTrack struct {
	Members domain.MembershipRepo
}

// JoinTrackInput.
type JoinTrackInput struct {
	UserID  uuid.UUID
	TrackID uuid.UUID
}

// Do enrols the user. When already enrolled and paused, it resumes
// (clears paused_at) instead of erroring out — UX-wise "Join" on a
// paused track means "I'm coming back to this".
func (uc *JoinTrack) Do(ctx context.Context, in JoinTrackInput) (domain.UserTrack, error) {
	if in.UserID == uuid.Nil || in.TrackID == uuid.Nil {
		return domain.UserTrack{}, fmt.Errorf("tracks.JoinTrack: %w: nil id", domain.ErrInvalidInput)
	}
	out, err := uc.Members.Join(ctx, domain.UserTrack{
		UserID:      in.UserID,
		TrackID:     in.TrackID,
		CurrentStep: 0,
		JoinedAt:    time.Now().UTC(),
	})
	if err == nil {
		return out, nil
	}
	if !errors.Is(err, domain.ErrAlreadyJoined) {
		return domain.UserTrack{}, fmt.Errorf("tracks.JoinTrack: %w", err)
	}
	// Already enrolled — resume by clearing paused_at if set.
	existing, gerr := uc.Members.Get(ctx, in.UserID, in.TrackID)
	if gerr != nil {
		return domain.UserTrack{}, fmt.Errorf("tracks.JoinTrack: %w", gerr)
	}
	if existing.PausedAt != nil {
		resumed, perr := uc.Members.SetPaused(ctx, in.UserID, in.TrackID, false)
		if perr != nil {
			return domain.UserTrack{}, fmt.Errorf("tracks.JoinTrack: resume: %w", perr)
		}
		return resumed, nil
	}
	return existing, nil
}

// AdvanceStep — bump current_step by one. Stamps completed_at when
// the next step would be past the last.
type AdvanceStep struct {
	Catalog domain.CatalogRepo
	Members domain.MembershipRepo
}

// AdvanceStepInput.
type AdvanceStepInput struct {
	UserID  uuid.UUID
	TrackID uuid.UUID
}

// Do executes the use case.
func (uc *AdvanceStep) Do(ctx context.Context, in AdvanceStepInput) (domain.UserTrack, error) {
	tracker, err := uc.Members.Get(ctx, in.UserID, in.TrackID)
	if err != nil {
		return domain.UserTrack{}, fmt.Errorf("tracks.AdvanceStep: %w", err)
	}
	track, err := uc.Catalog.GetByID(ctx, in.TrackID)
	if err != nil {
		return domain.UserTrack{}, fmt.Errorf("tracks.AdvanceStep: %w", err)
	}
	next := tracker.CurrentStep + 1
	if next > len(track.Steps) {
		next = len(track.Steps)
	}
	out, err := uc.Members.SetCurrentStep(ctx, in.UserID, in.TrackID, next, len(track.Steps))
	if err != nil {
		return domain.UserTrack{}, fmt.Errorf("tracks.AdvanceStep: %w", err)
	}
	return out, nil
}

// PauseTrack — sets paused_at = now. UX symmetric with JoinTrack-as-resume.
type PauseTrack struct {
	Members domain.MembershipRepo
}

// Do executes the use case.
func (uc *PauseTrack) Do(ctx context.Context, userID, trackID uuid.UUID) (domain.UserTrack, error) {
	out, err := uc.Members.SetPaused(ctx, userID, trackID, true)
	if err != nil {
		return domain.UserTrack{}, fmt.Errorf("tracks.PauseTrack: %w", err)
	}
	return out, nil
}

// LeaveTrack — drops the enrolment row.
type LeaveTrack struct {
	Members domain.MembershipRepo
}

// Do executes the use case.
func (uc *LeaveTrack) Do(ctx context.Context, userID, trackID uuid.UUID) error {
	if err := uc.Members.Leave(ctx, userID, trackID); err != nil {
		return fmt.Errorf("tracks.LeaveTrack: %w", err)
	}
	return nil
}
