package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/daily/domain"

	"github.com/google/uuid"
)

// GetStreak implements GET /daily/streak.
type GetStreak struct {
	Streaks domain.StreakRepo
	Katas   domain.KataRepo
	Now     func() time.Time
}

// Do loads the streak state and builds a 30-day history window.
func (uc *GetStreak) Do(ctx context.Context, userID uuid.UUID) (domain.StreakInfo, error) {
	now := uc.Now().UTC()
	today := now.Truncate(24 * time.Hour)
	s, err := uc.Streaks.Get(ctx, userID)
	if err != nil && !isMissing(err) {
		return domain.StreakInfo{}, fmt.Errorf("daily.GetStreak: state: %w", err)
	}
	history, err := uc.Katas.HistoryLast30(ctx, userID, today)
	if err != nil {
		return domain.StreakInfo{}, fmt.Errorf("daily.GetStreak: history: %w", err)
	}
	out, err := buildStreakInfo(s, history)
	if err != nil {
		return domain.StreakInfo{}, fmt.Errorf("daily.GetStreak: build: %w", err)
	}
	return out, nil
}

// buildStreakInfo projects state + history into the StreakInfo DTO.
// history entries with FreezeUsed==true become nil in the history slice,
// per the openapi convention (null = freeze).
func buildStreakInfo(s domain.StreakState, history []domain.HistoryEntry) (domain.StreakInfo, error) {
	slice := make([]*bool, 0, len(history))
	for _, h := range history {
		switch {
		case h.FreezeUsed:
			slice = append(slice, nil)
		case h.Passed != nil:
			v := *h.Passed
			slice = append(slice, &v)
		default:
			f := false
			slice = append(slice, &f)
		}
	}
	return domain.StreakInfo{
		Current:      s.CurrentStreak,
		Longest:      s.LongestStreak,
		FreezeTokens: s.FreezeTokens,
		LastKataDate: s.LastKataDate,
		History:      slice,
	}, nil
}

// loadTodaysTaskID finds today's TaskID in the 30-day history slice.
func loadTodaysTaskID(history []domain.HistoryEntry, today time.Time) uuid.UUID {
	for _, h := range history {
		if sameDay(h.Date, today) {
			return h.TaskID
		}
	}
	return uuid.Nil
}

func isMissing(err error) bool {
	return errors.Is(err, domain.ErrNotFound)
}

// ── streak calendar (year-grid) ──────────────────────────────────────────

// DefaultFreezeMax is the cap on visible freeze-token slots in the UI.
// Streaks domain caps freeze_tokens at this number too. Centralised so the
// UI and the use case can't drift.
const DefaultFreezeMax = 5

// MonthBucket is one of the twelve cells in the year-grid. `Total` is the
// number of *real* days in that month (28..31), `Done`/`Missed`/`Freeze`
// are the per-month aggregates over daily_kata_history.
type MonthBucket struct {
	Index  int    // 1..12
	Name   string // "ЯНВ", "ФЕВ", ...
	Done   int
	Missed int
	Freeze int
	Total  int
}

// StreakCalendar is the response shape of GET /api/v1/kata/streak.
type StreakCalendar struct {
	Year         int
	Current      int
	Best         int
	FreezeTokens int
	FreezeMax    int
	TotalDone    int
	TotalMissed  int
	TotalFreeze  int
	Remaining    int
	Months       []MonthBucket
}

// monthNamesRU is the short Russian month label set used by the UI grid.
var monthNamesRU = [12]string{
	"ЯНВ", "ФЕВ", "МАР", "АПР", "МАЙ", "ИЮН",
	"ИЮЛ", "АВГ", "СЕН", "ОКТ", "НОЯ", "ДЕК",
}

// GetStreakCalendar implements the year-grid endpoint that powers
// /daily/streak. It is intentionally a separate use-case from GetStreak —
// the latter returns the rolling 30-day window for tooltip/profile cards
// and is hit on every /daily/* page; this one is mounted only on the
// dedicated streak page and pulls a full year of history.
type GetStreakCalendar struct {
	Streaks domain.StreakRepo
	Katas   domain.KataRepo
	Now     func() time.Time
}

// Do loads the streak state + a year of history and projects them onto
// month buckets. Year defaults to "now's UTC year" if 0 is passed.
func (uc *GetStreakCalendar) Do(ctx context.Context, userID uuid.UUID, year int) (StreakCalendar, error) {
	now := uc.Now().UTC()
	if year == 0 {
		year = now.Year()
	}
	if year < 2000 || year > 9999 {
		return StreakCalendar{}, fmt.Errorf("daily.GetStreakCalendar: year out of range %d", year)
	}
	state, err := uc.Streaks.Get(ctx, userID)
	if err != nil && !isMissing(err) {
		return StreakCalendar{}, fmt.Errorf("daily.GetStreakCalendar: state: %w", err)
	}
	history, err := uc.Katas.HistoryByYear(ctx, userID, year)
	if err != nil {
		return StreakCalendar{}, fmt.Errorf("daily.GetStreakCalendar: history: %w", err)
	}
	out := buildStreakCalendar(state, history, year, now)
	return out, nil
}

// buildStreakCalendar projects history rows onto month buckets and
// computes the page-header counters. Pure for testability.
func buildStreakCalendar(state domain.StreakState, history []domain.HistoryEntry, year int, now time.Time) StreakCalendar {
	out := StreakCalendar{
		Year:         year,
		Current:      state.CurrentStreak,
		Best:         state.LongestStreak,
		FreezeTokens: state.FreezeTokens,
		FreezeMax:    DefaultFreezeMax,
		Months:       make([]MonthBucket, 12),
	}
	for i := 0; i < 12; i++ {
		out.Months[i] = MonthBucket{
			Index: i + 1,
			Name:  monthNamesRU[i],
			Total: daysInMonth(year, time.Month(i+1)),
		}
	}
	for _, h := range history {
		d := h.Date.UTC()
		if d.Year() != year {
			continue
		}
		idx := int(d.Month()) - 1
		if idx < 0 || idx >= 12 {
			continue
		}
		switch {
		case h.FreezeUsed:
			out.Months[idx].Freeze++
			out.TotalFreeze++
		case h.Passed != nil && *h.Passed:
			out.Months[idx].Done++
			out.TotalDone++
		default:
			// nil Passed (no submission for an assigned day) or false.
			out.Months[idx].Missed++
			out.TotalMissed++
		}
	}
	out.Remaining = remainingDays(year, now)
	return out
}

// daysInMonth returns the number of days in (year, month) — handles leap
// February. Equivalent to time.Date(year, month+1, 0, ...).Day().
func daysInMonth(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// remainingDays returns "days left in the year" relative to `now`. For a
// past year we report 0; for a future year — full year.
func remainingDays(year int, now time.Time) int {
	now = now.UTC().Truncate(24 * time.Hour)
	if now.Year() > year {
		return 0
	}
	end := time.Date(year, time.December, 31, 0, 0, 0, 0, time.UTC)
	if now.Year() < year {
		return end.YearDay()
	}
	d := int(end.Sub(now).Hours()/24) + 1
	if d < 0 {
		return 0
	}
	return d
}
