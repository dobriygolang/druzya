// streak_calendar_test.go — unit tests for the year-grid use case
// (GetStreakCalendar) backing GET /api/v1/kata/streak.
//
// We deliberately avoid pgxmock here: the projection logic
// (history rows → 12 month buckets + counters) is pure and lives in
// buildStreakCalendar. The use-case path is covered via the gomock-
// generated KataRepo / StreakRepo mocks under daily/domain/mocks.
package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/daily/domain"
	"druz9/daily/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// helper: build a HistoryEntry for date Y-M-D with passed/freeze flags.
func entry(year int, month time.Month, day int, passed *bool, freeze bool) domain.HistoryEntry {
	return domain.HistoryEntry{
		Date:       time.Date(year, month, day, 0, 0, 0, 0, time.UTC),
		TaskID:     uuid.New(),
		Passed:     passed,
		FreezeUsed: freeze,
	}
}

func boolPtr(b bool) *bool { return &b }

func TestBuildStreakCalendar_AggregatesByMonth(t *testing.T) {
	t.Parallel()
	state := domain.StreakState{CurrentStreak: 7, LongestStreak: 30, FreezeTokens: 2}
	now := time.Date(2026, 4, 22, 12, 0, 0, 0, time.UTC)
	hist := []domain.HistoryEntry{
		entry(2026, time.January, 5, boolPtr(true), false),
		entry(2026, time.January, 6, boolPtr(false), false),
		entry(2026, time.January, 7, nil, true),
		entry(2026, time.February, 1, boolPtr(true), false),
		entry(2026, time.February, 2, boolPtr(true), false),
		entry(2026, time.April, 20, boolPtr(true), false),
	}
	got := buildStreakCalendar(state, hist, 2026, now)

	if got.Year != 2026 {
		t.Fatalf("year = %d, want 2026", got.Year)
	}
	if got.Current != 7 || got.Best != 30 || got.FreezeTokens != 2 {
		t.Fatalf("state didn't propagate: %+v", got)
	}
	if got.FreezeMax != DefaultFreezeMax {
		t.Fatalf("freeze max should default, got %d", got.FreezeMax)
	}
	if got.TotalDone != 4 {
		t.Fatalf("TotalDone = %d, want 4", got.TotalDone)
	}
	if got.TotalMissed != 1 {
		t.Fatalf("TotalMissed = %d, want 1", got.TotalMissed)
	}
	if got.TotalFreeze != 1 {
		t.Fatalf("TotalFreeze = %d, want 1", got.TotalFreeze)
	}
	if len(got.Months) != 12 {
		t.Fatalf("expected 12 months, got %d", len(got.Months))
	}
	jan := got.Months[0]
	if jan.Done != 1 || jan.Missed != 1 || jan.Freeze != 1 {
		t.Fatalf("Jan: %+v", jan)
	}
	if jan.Total != 31 {
		t.Fatalf("Jan total: want 31, got %d", jan.Total)
	}
	feb := got.Months[1]
	if feb.Done != 2 {
		t.Fatalf("Feb done = %d", feb.Done)
	}
	if feb.Total != 28 { // 2026 is not a leap year
		t.Fatalf("Feb total: want 28, got %d", feb.Total)
	}
	if got.Months[3].Done != 1 {
		t.Fatalf("Apr done = %d", got.Months[3].Done)
	}
}

func TestBuildStreakCalendar_LeapFebruary(t *testing.T) {
	t.Parallel()
	state := domain.StreakState{}
	now := time.Date(2024, 4, 22, 0, 0, 0, 0, time.UTC)
	got := buildStreakCalendar(state, nil, 2024, now)
	if got.Months[1].Total != 29 {
		t.Fatalf("Feb 2024 should have 29 days, got %d", got.Months[1].Total)
	}
}

func TestBuildStreakCalendar_FiltersOtherYears(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	hist := []domain.HistoryEntry{
		entry(2025, time.December, 31, boolPtr(true), false), // ignored
		entry(2026, time.January, 1, boolPtr(true), false),
		entry(2027, time.January, 1, boolPtr(true), false), // ignored
	}
	got := buildStreakCalendar(domain.StreakState{}, hist, 2026, now)
	if got.TotalDone != 1 {
		t.Fatalf("expected only the 2026 row to count, got TotalDone=%d", got.TotalDone)
	}
}

func TestBuildStreakCalendar_RemainingDays(t *testing.T) {
	t.Parallel()
	// Mid-year, the remainder should be (days in year) - day-of-year + 1
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	got := buildStreakCalendar(domain.StreakState{}, nil, 2026, now)
	if got.Remaining != 365 { // 2026 is a non-leap year
		t.Fatalf("Remaining at Jan 1 2026 should be 365, got %d", got.Remaining)
	}
	// Past year — nothing remaining.
	gotPast := buildStreakCalendar(domain.StreakState{}, nil, 2024, now)
	if gotPast.Remaining != 0 {
		t.Fatalf("past year should have 0 remaining, got %d", gotPast.Remaining)
	}
	// Future year — full year remaining.
	gotFut := buildStreakCalendar(domain.StreakState{}, nil, 2030, now)
	if gotFut.Remaining != 365 {
		t.Fatalf("future year remaining = %d", gotFut.Remaining)
	}
}

func TestBuildStreakCalendar_MissedNilTreatedAsMiss(t *testing.T) {
	t.Parallel()
	// nil Passed without FreezeUsed = missed.
	hist := []domain.HistoryEntry{entry(2026, time.March, 10, nil, false)}
	got := buildStreakCalendar(domain.StreakState{}, hist, 2026, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	if got.TotalMissed != 1 {
		t.Fatalf("TotalMissed = %d, want 1", got.TotalMissed)
	}
}

func TestGetStreakCalendar_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	katas := mocks.NewMockKataRepo(ctrl)
	streaks := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	now := time.Date(2026, 4, 22, 12, 0, 0, 0, time.UTC)

	streaks.EXPECT().Get(gomock.Any(), uid).Return(
		domain.StreakState{CurrentStreak: 12, LongestStreak: 47, FreezeTokens: 3},
		nil,
	)
	katas.EXPECT().HistoryByYear(gomock.Any(), uid, 2026).Return(
		[]domain.HistoryEntry{
			entry(2026, time.January, 5, boolPtr(true), false),
			entry(2026, time.April, 22, boolPtr(true), false),
		},
		nil,
	)

	uc := &GetStreakCalendar{Streaks: streaks, Katas: katas, Now: func() time.Time { return now }}
	got, err := uc.Do(context.Background(), uid, 0) // 0 → use current year
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if got.Year != 2026 {
		t.Fatalf("year=%d", got.Year)
	}
	if got.Current != 12 || got.Best != 47 || got.FreezeTokens != 3 {
		t.Fatalf("state: %+v", got)
	}
	if got.TotalDone != 2 {
		t.Fatalf("TotalDone=%d", got.TotalDone)
	}
}

func TestGetStreakCalendar_NewUserNoStreak(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	katas := mocks.NewMockKataRepo(ctrl)
	streaks := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	now := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)

	streaks.EXPECT().Get(gomock.Any(), uid).Return(domain.StreakState{}, domain.ErrNotFound)
	katas.EXPECT().HistoryByYear(gomock.Any(), uid, 2026).Return([]domain.HistoryEntry{}, nil)

	uc := &GetStreakCalendar{Streaks: streaks, Katas: katas, Now: func() time.Time { return now }}
	got, err := uc.Do(context.Background(), uid, 2026)
	if err != nil {
		t.Fatalf("ErrNotFound on streak should be swallowed: %v", err)
	}
	if got.Current != 0 || got.Best != 0 || got.TotalDone != 0 {
		t.Fatalf("expected zero streak for new user, got %+v", got)
	}
	if len(got.Months) != 12 {
		t.Fatalf("months = %d", len(got.Months))
	}
}

func TestGetStreakCalendar_HistoryError(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	katas := mocks.NewMockKataRepo(ctrl)
	streaks := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	now := time.Date(2026, 4, 22, 0, 0, 0, 0, time.UTC)

	streaks.EXPECT().Get(gomock.Any(), uid).Return(domain.StreakState{}, nil)
	katas.EXPECT().HistoryByYear(gomock.Any(), uid, 2026).Return(nil, errors.New("boom"))

	uc := &GetStreakCalendar{Streaks: streaks, Katas: katas, Now: func() time.Time { return now }}
	if _, err := uc.Do(context.Background(), uid, 2026); err == nil {
		t.Fatal("expected error from history failure")
	}
}

func TestGetStreakCalendar_BadYear(t *testing.T) {
	t.Parallel()
	uc := &GetStreakCalendar{Now: func() time.Time { return time.Now() }}
	if _, err := uc.Do(context.Background(), uuid.New(), 1); err == nil {
		t.Fatal("expected error for year=1")
	}
	if _, err := uc.Do(context.Background(), uuid.New(), 99999); err == nil {
		t.Fatal("expected error for year=99999")
	}
}

func TestDaysInMonth_KnownCalendar(t *testing.T) {
	t.Parallel()
	cases := []struct {
		year  int
		month time.Month
		want  int
	}{
		{2026, time.January, 31},
		{2026, time.February, 28},
		{2024, time.February, 29}, // leap
		{2026, time.April, 30},
		{2026, time.December, 31},
	}
	for _, c := range cases {
		if got := daysInMonth(c.year, c.month); got != c.want {
			t.Errorf("daysInMonth(%d, %s) = %d, want %d", c.year, c.month, got, c.want)
		}
	}
}
