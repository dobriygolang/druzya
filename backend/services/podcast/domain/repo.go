//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// PodcastRepo is the persistence port for podcasts and podcast_progress.
type PodcastRepo interface {
	// ListForUser returns every published podcast, each annotated with the
	// user's listened_sec + completion flag. When section != nil the results
	// are filtered server-side.
	ListForUser(ctx context.Context, userID uuid.UUID, section *enums.Section) ([]Listing, error)

	// GetByID returns a single podcast row. ErrNotFound when missing.
	GetByID(ctx context.Context, podcastID uuid.UUID) (Podcast, error)

	// GetProgress loads the user's progress for a podcast. Missing row MUST
	// return a zero-valued Progress (ListenedSec=0, CompletedAt=nil) rather
	// than ErrNotFound — the first PUT is always a fresh insert.
	GetProgress(ctx context.Context, userID, podcastID uuid.UUID) (Progress, error)

	// UpsertProgress writes the progress row. completed_at is preserved on
	// update (ON CONFLICT DO UPDATE SET completed_at = COALESCE(existing, new))
	// so the first completion wins.
	UpsertProgress(ctx context.Context, p Progress) error
}

// AudioSigner returns a time-limited URL the client can stream from. In
// production this wraps a MinIO presigner; MVP returns a stable relative URL.
//
// STUB: see infra.FakeSigner.
type AudioSigner interface {
	// Sign returns a streamable URL for the given audio_key. Implementations
	// are expected to attach a short TTL (e.g. 1h) via query params.
	Sign(ctx context.Context, audioKey string) (string, error)
}
