package domain

import (
	"crypto/sha256"
	"encoding/binary"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// KataModifiers reports whether today's kata is cursed/weekly-boss based on
// the supplied date (wall-clock, not user timezone — Fridays + Sundays in UTC).
// Pulled out so it stays deterministic for tests.
func KataModifiers(date time.Time) (isCursed, isWeeklyBoss bool) {
	switch date.Weekday() {
	case time.Friday:
		isCursed = true
	case time.Sunday:
		isWeeklyBoss = true
	case time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Saturday:
		// regular day, nothing special
	}
	return
}

// PickKataForUser is the pure selection function. Given the candidate set and
// a (user_id, date) pair it returns the deterministic pick so refreshing the
// page within the same day always yields the same kata.
//
// The selection hashes (userID || yyyy-mm-dd) with SHA-256 and mod-indexes
// into the slice. No randomness — same (user, date) always maps to same index.
func PickKataForUser(userID uuid.UUID, date time.Time, candidates []TaskPublic) (TaskPublic, bool) {
	if len(candidates) == 0 {
		return TaskPublic{}, false
	}
	h := sha256.New()
	h.Write(userID[:])
	day := date.UTC().Format("2006-01-02")
	h.Write([]byte(day))
	sum := h.Sum(nil)
	idx := binary.BigEndian.Uint64(sum[:8]) % uint64(len(candidates))
	return candidates[idx], true
}

// DifficultyForProgress maps a skill-node progress % onto a task difficulty.
// Low progress → easy; mid → medium; high → hard. Pure to keep testable.
func DifficultyForProgress(progress int) enums.Difficulty {
	switch {
	case progress >= 70:
		return enums.DifficultyHard
	case progress >= 35:
		return enums.DifficultyMedium
	default:
		return enums.DifficultyEasy
	}
}

// DaysLeft computes how many whole days remain until `interviewDate`.
// Negative results are clamped to 0.
func DaysLeft(interviewDate, now time.Time) int {
	d := int(interviewDate.Sub(now.UTC().Truncate(24*time.Hour)).Hours() / 24)
	if d < 0 {
		return 0
	}
	return d
}

// ComputeReadinessPct is a STUB readiness score — replaces LLM-backed computation.
// Formula: baseline 30% + 5 per percent-completed-atlas-node-sample + cap 95%.
// STUB: real readiness formula uses skill decay, calendar progress, mock scores.
func ComputeReadinessPct(daysLeft int, avgNodeProgress int) int {
	base := 30 + avgNodeProgress/2
	if daysLeft < 7 {
		base += 5
	}
	if base > 95 {
		return 95
	}
	if base < 0 {
		return 0
	}
	return base
}
