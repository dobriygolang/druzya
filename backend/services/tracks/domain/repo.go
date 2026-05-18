package domain

import (
	"context"

	"github.com/google/uuid"
)

// CatalogRepo is the read-side port for the curated catalogue + a
// detail fetch. Both calls are read-only; admin CRUD lives in a
// separate (TBD) admin port to keep the public reads narrow.
type CatalogRepo interface {
	// ListActive returns every active track. The catalogue is small
	// (curated set ~10) so we don't paginate yet.
	ListActive(ctx context.Context) ([]Track, error)

	// GetBySlug fetches one track + its ordered steps. ErrNotFound when
	// the slug is unknown or the track is_active=false.
	GetBySlug(ctx context.Context, slug string) (TrackWithSteps, error)

	// GetByID is the same fetch keyed by uuid — used by the coach
	// reader, not the public UI.
	GetByID(ctx context.Context, id uuid.UUID) (TrackWithSteps, error)
}

// MembershipRepo owns user_tracks rows.
type MembershipRepo interface {
	// ListByUser returns every enrolment (active + paused + completed)
	// joined with the parent track row. UI splits client-side; coach
	// reads this directly.
	ListByUser(ctx context.Context, userID uuid.UUID) ([]UserTrackProgress, error)

	// Get fetches one enrolment row. ErrNotFound when not joined.
	Get(ctx context.Context, userID, trackID uuid.UUID) (UserTrack, error)

	// Join inserts a fresh enrolment. ErrAlreadyJoined when a row
	// already exists for (user, track) — caller decides whether to
	// reuse the existing row (re-open from "paused") or surface the
	// error to UI.
	Join(ctx context.Context, in UserTrack) (UserTrack, error)

	// SetCurrentStep advances the pointer. Stamps completed_at when
	// next == len(steps).
	SetCurrentStep(ctx context.Context, userID, trackID uuid.UUID, next int, totalSteps int) (UserTrack, error)

	// SetPaused toggles paused_at. paused=true → set now(); false → NULL.
	SetPaused(ctx context.Context, userID, trackID uuid.UUID, paused bool) (UserTrack, error)

	// Leave removes the enrolment row entirely. Used for "I changed
	// my mind, this isn't for me" — distinct from pause.
	Leave(ctx context.Context, userID, trackID uuid.UUID) error
}

// CheckpointRepo owns step_checkpoint_attempts.
type CheckpointRepo interface {
	// Insert записывает результат attempt'а. ID + CreatedAt выставляются
	// репозиторием.
	Insert(ctx context.Context, in CheckpointAttempt) (CheckpointAttempt, error)

	// LatestForStep возвращает последнюю попытку юзера на (track, step).
	// ErrNotFound если попыток ещё не было.
	LatestForStep(ctx context.Context, userID, trackID uuid.UUID, stepIndex int) (CheckpointAttempt, error)

	// HasPassed — true если хотя бы одна passed_at IS NOT NULL для (user,
	// track, step). Используется для unlock-gate.
	HasPassed(ctx context.Context, userID, trackID uuid.UUID, stepIndex int) (bool, error)
}
