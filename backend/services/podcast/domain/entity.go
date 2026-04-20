package domain

import (
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Sentinel errors.
var (
	ErrNotFound        = errors.New("podcast: not found")
	ErrInvalidDuration = errors.New("podcast: listened_sec out of range")
)

// CompletionThresholdSec is the "close enough" window for auto-completion.
// If the user has listened to within this many seconds of the episode's
// duration, we flip completed_at on their behalf.
const CompletionThresholdSec = 10

// Podcast mirrors a row of `podcasts`.
type Podcast struct {
	ID          uuid.UUID
	TitleRu     string
	TitleEn     string
	Description string
	Section     enums.Section
	DurationSec int
	AudioKey    string
	IsPublished bool
	CreatedAt   time.Time
}

// Progress mirrors a row of `podcast_progress`.
type Progress struct {
	UserID      uuid.UUID
	PodcastID   uuid.UUID
	ListenedSec int
	CompletedAt *time.Time
	UpdatedAt   time.Time
}

// IsComplete reports whether the progress row represents a finished episode.
func (p Progress) IsComplete() bool { return p.CompletedAt != nil }

// Listing is the app-level projection used by GET /podcast — one Podcast plus
// the requesting user's progress info.
type Listing struct {
	Podcast   Podcast
	Progress  int
	Completed bool
}
