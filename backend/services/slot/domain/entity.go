// Package domain contains the entities, value objects and repository interfaces
// for the slot (Human Mock Interview) bounded context. No framework imports.
package domain

import (
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Sentinel errors.
var (
	ErrNotFound          = errors.New("slot: not found")
	ErrForbidden         = errors.New("slot: forbidden")
	ErrNotAvailable      = errors.New("slot: not available for booking")
	ErrPastStart         = errors.New("slot: starts_at must be in the future")
	ErrInvalidDuration   = errors.New("slot: duration_min must be between 15 and 180")
	ErrInvalidPrice      = errors.New("slot: price_rub must be >= 0")
	ErrInvalidSection    = errors.New("slot: invalid section")
	ErrInvalidDifficulty = errors.New("slot: invalid difficulty")
	ErrSelfBooking       = errors.New("slot: interviewer cannot book own slot")
	ErrOverlapping       = errors.New("slot: overlaps an existing slot")
	ErrNotInterviewer    = errors.New("slot: only users with role=interviewer can create slots")
	ErrAlreadyBooked     = errors.New("slot: already booked")
	ErrBookingNotFound   = errors.New("slot: booking not found")
)

// Language constants (mirror openapi enum ru|en for Slot.Language).
const (
	LanguageRu = "ru"
	LanguageEn = "en"
)

// Duration bounds (minutes).
const (
	MinDurationMin = 15
	MaxDurationMin = 180
)

// Slot mirrors a `slots` row plus interviewer stats when hydrated.
type Slot struct {
	ID            uuid.UUID
	InterviewerID uuid.UUID
	StartsAt      time.Time
	DurationMin   int
	Section       enums.Section
	Difficulty    *enums.Difficulty
	Language      string
	PriceRub      int
	Status        enums.SlotStatus
	CreatedAt     time.Time

	// Hydrated by the use-case layer for the public DTO.
	InterviewerUsername     string
	InterviewerAvgRating    *float32
	InterviewerReviewsCount *int
}

// EndsAt returns the exclusive end time of a slot.
func (s Slot) EndsAt() time.Time {
	return s.StartsAt.Add(time.Duration(s.DurationMin) * time.Minute)
}

// Overlaps reports whether two slots share any instant of time.
// Semantics: `[start, end)` intervals.
func (s Slot) Overlaps(other Slot) bool {
	return s.StartsAt.Before(other.EndsAt()) && other.StartsAt.Before(s.EndsAt())
}

// Booking mirrors a `bookings` row.
type Booking struct {
	ID          uuid.UUID
	SlotID      uuid.UUID
	CandidateID uuid.UUID
	MeetURL     string
	Status      string
	CreatedAt   time.Time
}

// Review mirrors a `slot_reviews` row.
type Review struct {
	BookingID  uuid.UUID
	ReviewerID uuid.UUID
	Rating     int
	Feedback   string
	CreatedAt  time.Time
}

// ListFilter captures query params for ListAvailableSlots.
type ListFilter struct {
	Section    *enums.Section
	Difficulty *enums.Difficulty
	From       *time.Time
	To         *time.Time
	Limit      int // 0 => default applied by infra
}
