package domain

import (
	"time"

	"github.com/google/uuid"
)

// ValidateSlot runs pure business rules against a freshly-built slot:
//   - starts_at must be strictly in the future (relative to `now`)
//   - duration_min must be within [MinDurationMin, MaxDurationMin]
//   - price_rub must be non-negative
//   - section must be valid
//   - difficulty, when provided, must be valid
//
// The caller passes `now` so unit tests can run deterministically.
func ValidateSlot(s Slot, now time.Time) error {
	if !s.StartsAt.After(now) {
		return ErrPastStart
	}
	if s.DurationMin < MinDurationMin || s.DurationMin > MaxDurationMin {
		return ErrInvalidDuration
	}
	if s.PriceRub < 0 {
		return ErrInvalidPrice
	}
	if !s.Section.IsValid() {
		return ErrInvalidSection
	}
	if s.Difficulty != nil && !s.Difficulty.IsValid() {
		return ErrInvalidDifficulty
	}
	return nil
}

// CanBook checks whether `candidate` may book `slot` given the current time.
// Rules:
//   - the candidate may not be the slot's interviewer (no self-booking)
//   - the slot's status must be `available`
//   - the slot's starts_at must be in the future
func CanBook(slot Slot, candidateID uuid.UUID, now time.Time) error {
	if slot.InterviewerID == candidateID {
		return ErrSelfBooking
	}
	if string(slot.Status) != "available" {
		return ErrNotAvailable
	}
	if !slot.StartsAt.After(now) {
		return ErrPastStart
	}
	return nil
}

// ConflictsWith reports whether `new` overlaps any slot in `existing`.
// Ignores slots with a terminal status (cancelled / completed / no_show) so
// an interviewer can re-use those time windows.
func ConflictsWith(existing []Slot, new Slot) bool {
	for _, e := range existing {
		if e.ID == new.ID {
			// Same slot (used by tests passing the same instance twice).
			continue
		}
		switch string(e.Status) {
		case "cancelled", "completed", "no_show":
			continue
		}
		if e.Overlaps(new) {
			return true
		}
	}
	return false
}
