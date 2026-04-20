package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/podcast/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// UpdateProgressInput is the decoded request body for PUT /podcast/{id}/progress.
type UpdateProgressInput struct {
	UserID      uuid.UUID
	PodcastID   uuid.UUID
	ListenedSec int
	// Completed is the client's hint. Server overrides if the auto-threshold
	// fires first. Optional.
	Completed *bool
}

// ProgressView is the serialisable response for PUT /podcast/{id}/progress.
type ProgressView struct {
	PodcastID   uuid.UUID
	ProgressSec int
	Completed   bool
	CompletedAt *time.Time
}

// UpdateProgress is the use case behind PUT /podcast/{podcastId}/progress.
//
// Flow:
//  1. Load the podcast (for duration_sec) + existing progress row.
//  2. Domain.ApplyProgress does the clamp + auto-complete decision.
//  3. Upsert.
//  4. If the flip nil → non-nil happened, publish PodcastCompleted (LOCAL)
//     AND an XPGained (shared) event — the latter is what season subscribes to.
type UpdateProgress struct {
	Podcasts domain.PodcastRepo
	Bus      sharedDomain.Bus
	Log      *slog.Logger
	Now      func() time.Time
}

// NewUpdateProgress wires the use case.
func NewUpdateProgress(p domain.PodcastRepo, bus sharedDomain.Bus, log *slog.Logger) *UpdateProgress {
	return &UpdateProgress{
		Podcasts: p,
		Bus:      bus,
		Log:      log,
		Now:      func() time.Time { return time.Now().UTC() },
	}
}

// Do applies the update and returns the resulting projection.
func (uc *UpdateProgress) Do(ctx context.Context, in UpdateProgressInput) (ProgressView, error) {
	pod, err := uc.Podcasts.GetByID(ctx, in.PodcastID)
	if err != nil {
		return ProgressView{}, fmt.Errorf("podcast.UpdateProgress: %w", err)
	}
	cur, err := uc.Podcasts.GetProgress(ctx, in.UserID, in.PodcastID)
	if err != nil {
		return ProgressView{}, fmt.Errorf("podcast.UpdateProgress: %w", err)
	}

	now := uc.Now()
	newProg := domain.ApplyProgress(domain.Progress{
		UserID:      in.UserID,
		PodcastID:   in.PodcastID,
		ListenedSec: cur.ListenedSec,
		CompletedAt: cur.CompletedAt,
	}, in.ListenedSec, pod.DurationSec, now)

	// Honour the client's explicit completion flag only when the domain
	// logic hasn't already auto-completed. Prevents a PUT with
	// `completed: false` from un-completing a finished episode.
	if in.Completed != nil && *in.Completed && newProg.CompletedAt == nil {
		t := now
		newProg.CompletedAt = &t
	}

	if err := uc.Podcasts.UpsertProgress(ctx, newProg); err != nil {
		return ProgressView{}, fmt.Errorf("podcast.UpdateProgress: %w", err)
	}

	// Idempotent publish: only when this call actually flipped completion.
	if domain.WasJustCompleted(cur, newProg) {
		uc.publishCompletion(ctx, in.UserID, in.PodcastID, pod.DurationSec, now)
	}

	return ProgressView{
		PodcastID:   in.PodcastID,
		ProgressSec: newProg.ListenedSec,
		Completed:   newProg.CompletedAt != nil,
		CompletedAt: newProg.CompletedAt,
	}, nil
}

// publishCompletion fires two events on completion:
//   - LOCAL podcast.PodcastCompleted (for future in-domain consumers)
//   - shared progress.XPGained (for season/profile to observe uniformly)
//
// A failure to publish is logged and swallowed — progress is persisted, so
// the client response stays authoritative.
func (uc *UpdateProgress) publishCompletion(ctx context.Context, userID, podcastID uuid.UUID, duration int, now time.Time) {
	if uc.Bus == nil {
		return
	}
	local := domain.PodcastCompleted{
		At:          now,
		UserID:      userID,
		PodcastID:   podcastID,
		DurationSec: duration,
	}
	if err := uc.Bus.Publish(ctx, local); err != nil {
		uc.Log.WarnContext(ctx, "podcast.UpdateProgress: publish PodcastCompleted", slog.Any("err", err))
	}
	xp := sharedDomain.XPGained{
		UserID: userID,
		Amount: domain.PodcastXPPerEpisode,
		Reason: "podcast_completed",
	}
	if err := uc.Bus.Publish(ctx, xp); err != nil {
		uc.Log.WarnContext(ctx, "podcast.UpdateProgress: publish XPGained", slog.Any("err", err))
	}
}
