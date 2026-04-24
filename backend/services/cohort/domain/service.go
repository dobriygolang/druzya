package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Clock abstracts time.Now so tests can drive it deterministically.
type Clock interface {
	Now() time.Time
}

// RealClock is the production Clock.
type RealClock struct{}

// Now returns time.Now in UTC.
func (RealClock) Now() time.Time { return time.Now().UTC() }

// FixedClock is a test Clock returning a fixed instant; call Advance to move it.
type FixedClock struct{ T time.Time }

// Now returns the fixed instant.
func (c *FixedClock) Now() time.Time { return c.T }

// Advance moves the clock forward by d.
func (c *FixedClock) Advance(d time.Duration) { c.T = c.T.Add(d) }

// IsWarActive reports whether `now` falls inside `[WeekStart, WeekEnd)`.
// Boundary semantics: the week-start is inclusive, the week-end is exclusive
// so contributions at exactly midnight of the new week are rejected.
func IsWarActive(w War, now time.Time) bool {
	if now.Before(w.WeekStart) {
		return false
	}
	if !now.Before(w.WeekEnd) {
		return false
	}
	return true
}

// SideForCohort returns which side of the war the cohort ID belongs to.
// Returns false when the cohort is not a participant.
func SideForCohort(w War, cohortID uuid.UUID) (Side, bool) {
	switch cohortID {
	case w.CohortAID:
		return SideA, true
	case w.CohortBID:
		return SideB, true
	}
	return "", false
}

// CanContribute checks that the member is assigned to the war's section
// (or has no assignment in which case they may contribute to any). It also
// verifies the war is active. Returns the domain error so callers can map to
// HTTP validation errors consistently.
func CanContribute(m Member, w War, section enums.Section, now time.Time) error {
	if !section.IsValid() {
		return ErrInvalidSection
	}
	if !IsWarActive(w, now) {
		return ErrWarNotActive
	}
	if m.AssignedSection != nil && *m.AssignedSection != section {
		return ErrWrongSection
	}
	return nil
}

// AggregateScore sums the scores of a contribution slice. Pure utility used
// when the caller already has a filtered list (e.g. per line).
func AggregateScore(cs []Contribution) int {
	total := 0
	for _, c := range cs {
		total += c.Score
	}
	return total
}

// TallyLines folds a contribution list + the war's scores JSONB into the
// WarLine[] projection served by the API. Lines are returned in the fixed
// order defined by enums.AllSections().
func TallyLines(w War, cs []Contribution) []WarLine {
	// Index contributions per (section, side).
	bySection := make(map[enums.Section][]Contribution, WarLineCount)
	for _, c := range cs {
		bySection[c.Section] = append(bySection[c.Section], c)
	}
	lines := make([]WarLine, 0, WarLineCount)
	for _, s := range enums.AllSections() {
		line := WarLine{
			Section: s,
			ScoreA:  w.ScoresA[s],
			ScoreB:  w.ScoresB[s],
		}
		if cs := bySection[s]; len(cs) > 0 {
			line.Contributors = append(line.Contributors, cs...)
		}
		lines = append(lines, line)
	}
	return lines
}

// DetermineWinner walks the five lines and returns the cohort id that won the
// majority. Ties on a line count for neither side. Returns nil for an overall
// draw (e.g. 2-2 with one tied line).
func DetermineWinner(w War) *uuid.UUID {
	winsA, winsB := 0, 0
	for _, s := range enums.AllSections() {
		a := w.ScoresA[s]
		b := w.ScoresB[s]
		switch {
		case a > b:
			winsA++
		case b > a:
			winsB++
		default:
			// tie — line awarded to neither
		}
	}
	switch {
	case winsA > winsB:
		id := w.CohortAID
		return &id
	case winsB > winsA:
		id := w.CohortBID
		return &id
	default:
		return nil
	}
}
