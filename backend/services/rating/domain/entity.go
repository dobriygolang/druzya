// Package domain contains the rating bounded-context entities and pure
// service functions. No framework imports.
package domain

import (
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ErrNotFound is returned when a rating or user is missing.
var ErrNotFound = errors.New("rating: not found")

// SectionRating is a per-section ELO row (ratings table).
type SectionRating struct {
	UserID       uuid.UUID
	Section      enums.Section
	Elo          int
	MatchesCount int
	LastMatchAt  *time.Time
	UpdatedAt    time.Time
}

// LeaderboardEntry is a single rank within a section.
type LeaderboardEntry struct {
	UserID   uuid.UUID
	Username string
	Title    string
	Elo      int
	Rank     int
}

// HistorySample is a weekly snapshot of ELO for a section.
type HistorySample struct {
	Section enums.Section
	Week    time.Time // Monday of the ISO week, UTC
	Elo     int
}
