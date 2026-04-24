// Package domain — cohort announcement bounded context entities.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound          = errors.New("cohort_announcement: not found")
	ErrForbidden         = errors.New("cohort_announcement: forbidden")
	ErrEmptyBody         = errors.New("cohort_announcement: body required")
	ErrInvalidEmoji      = errors.New("cohort_announcement: emoji not in whitelist")
	ErrAlreadyReacted    = errors.New("cohort_announcement: already reacted")
)

// Allowed reaction emoji — kept in lock-step with the DB CHECK in
// migration 00051. Add to BOTH if you extend the set.
var AllowedEmoji = []string{"🔥", "👍", "❤️", "🎉", "🤔", "👀"}

func IsAllowedEmoji(e string) bool {
	for _, x := range AllowedEmoji {
		if x == e {
			return true
		}
	}
	return false
}

// Announcement mirrors a cohort_announcements row + denormalised author
// fields hydrated by ListByCohort.
type Announcement struct {
	ID                uuid.UUID
	CohortID          uuid.UUID
	AuthorID          uuid.UUID
	AuthorUsername    string
	AuthorDisplayName string
	Body              string
	Pinned            bool
	CreatedAt         time.Time
	UpdatedAt         time.Time

	// Hydrated by ListByCohort/Get; empty on raw inserts.
	Reactions      []ReactionGroup
	ViewerReacted  []string
}

type ReactionGroup struct {
	Emoji string
	Count int
}
