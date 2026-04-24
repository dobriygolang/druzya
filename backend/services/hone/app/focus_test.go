package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── fakes ─────────────────────────────────────────────────────────────────

type fakeFocusRepo struct {
	create func(context.Context, domain.FocusSession) (domain.FocusSession, error)
	end    func(context.Context, uuid.UUID, uuid.UUID, time.Time, int, int) (domain.FocusSession, error)
	get    func(context.Context, uuid.UUID, uuid.UUID) (domain.FocusSession, error)
}

func (f fakeFocusRepo) Create(ctx context.Context, s domain.FocusSession) (domain.FocusSession, error) {
	return f.create(ctx, s)
}
func (f fakeFocusRepo) End(ctx context.Context, u, sid uuid.UUID, t time.Time, p, sec int) (domain.FocusSession, error) {
	return f.end(ctx, u, sid, t, p, sec)
}
func (f fakeFocusRepo) Get(ctx context.Context, u, sid uuid.UUID) (domain.FocusSession, error) {
	return f.get(ctx, u, sid)
}

type fakeStreakRepo struct {
	getState          func(context.Context, uuid.UUID) (domain.StreakState, error)
	applyFocusSession func(context.Context, uuid.UUID, time.Time, int, int, int) (domain.StreakState, error)
	rangeDays         func(context.Context, uuid.UUID, time.Time, time.Time) ([]domain.StreakDay, error)
	applyCalls        []struct {
		day       time.Time
		seconds   int
		threshold int
	}
}

func (f *fakeStreakRepo) GetState(ctx context.Context, u uuid.UUID) (domain.StreakState, error) {
	return f.getState(ctx, u)
}
func (f *fakeStreakRepo) ApplyFocusSession(ctx context.Context, u uuid.UUID, day time.Time, sd, ssd, th int) (domain.StreakState, error) {
	f.applyCalls = append(f.applyCalls, struct {
		day       time.Time
		seconds   int
		threshold int
	}{day, sd, th})
	return f.applyFocusSession(ctx, u, day, sd, ssd, th)
}
func (f *fakeStreakRepo) RangeDays(ctx context.Context, u uuid.UUID, from, to time.Time) ([]domain.StreakDay, error) {
	return f.rangeDays(ctx, u, from, to)
}

// ─── StartFocus ────────────────────────────────────────────────────────────

func TestStartFocus_DefaultsMode(t *testing.T) {
	t.Parallel()
	// Invalid / empty mode input defaults to pomodoro rather than rejecting —
	// the client may forget to set the field, a timer is still a timer.
	var got domain.FocusSession
	uc := &StartFocus{
		Focus: fakeFocusRepo{
			create: func(_ context.Context, s domain.FocusSession) (domain.FocusSession, error) {
				got = s
				s.ID = uuid.New()
				return s, nil
			},
		},
		Log: discardLogger(),
		Now: fixedNow,
	}
	_, err := uc.Do(context.Background(), StartFocusInput{UserID: uuid.New(), Mode: "not-a-mode"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Mode != domain.FocusModePomodoro {
		t.Fatalf("default mode = %q, want pomodoro", got.Mode)
	}
	if got.StartedAt.IsZero() {
		t.Fatal("StartedAt not stamped")
	}
}

// ─── EndFocus ──────────────────────────────────────────────────────────────

func TestEndFocus_AppliesStreakOnSuccess(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	sid := uuid.New()
	nowUTC := fixedNow().UTC()
	streak := &fakeStreakRepo{
		applyFocusSession: func(_ context.Context, _ uuid.UUID, _ time.Time, _ int, _ int, _ int) (domain.StreakState, error) {
			return domain.StreakState{CurrentStreak: 1}, nil
		},
	}
	uc := &EndFocus{
		Focus: fakeFocusRepo{
			end: func(_ context.Context, _ uuid.UUID, _ uuid.UUID, _ time.Time, _ int, _ int) (domain.FocusSession, error) {
				return domain.FocusSession{ID: sid, UserID: uid, EndedAt: &nowUTC}, nil
			},
		},
		Streaks: streak,
		Log:     discardLogger(),
		Now:     fixedNow,
	}
	_, err := uc.Do(context.Background(), EndFocusInput{UserID: uid, SessionID: sid, SecondsFocused: 1500, PomodorosCompleted: 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(streak.applyCalls) != 1 {
		t.Fatalf("ApplyFocusSession called %d times, want 1", len(streak.applyCalls))
	}
	got := streak.applyCalls[0]
	if got.seconds != 1500 {
		t.Errorf("seconds delta = %d, want 1500", got.seconds)
	}
	if got.threshold != MinQualifyingFocusSeconds {
		t.Errorf("threshold = %d, want default %d", got.threshold, MinQualifyingFocusSeconds)
	}
	// day is always truncated to 00:00 UTC of the current day
	if !got.day.Equal(nowUTC.Truncate(24 * time.Hour)) {
		t.Errorf("day = %v, want %v", got.day, nowUTC.Truncate(24*time.Hour))
	}
}

func TestEndFocus_DoesNotFailWhenStreakApplyErrors(t *testing.T) {
	t.Parallel()
	// Streak aggregate is eventually-consistent: if the post-End streak
	// update fails (Redis stall, transient PG flake), the session itself
	// is already stored and the user should see the "you focused" path
	// complete. Reconciliation is the streak worker's problem, not the UC.
	streak := &fakeStreakRepo{
		applyFocusSession: func(_ context.Context, _ uuid.UUID, _ time.Time, _ int, _ int, _ int) (domain.StreakState, error) {
			return domain.StreakState{}, errors.New("transient")
		},
	}
	uc := &EndFocus{
		Focus: fakeFocusRepo{
			end: func(_ context.Context, _ uuid.UUID, _ uuid.UUID, _ time.Time, _ int, _ int) (domain.FocusSession, error) {
				return domain.FocusSession{}, nil
			},
		},
		Streaks: streak,
		Log:     discardLogger(),
		Now:     fixedNow,
	}
	if _, err := uc.Do(context.Background(), EndFocusInput{UserID: uuid.New(), SessionID: uuid.New()}); err != nil {
		t.Fatalf("End should succeed even when streak apply fails; got %v", err)
	}
}

func TestEndFocus_UsesCustomQualifyingSecondsWhenSet(t *testing.T) {
	t.Parallel()
	streak := &fakeStreakRepo{
		applyFocusSession: func(_ context.Context, _ uuid.UUID, _ time.Time, _ int, _ int, _ int) (domain.StreakState, error) {
			return domain.StreakState{}, nil
		},
	}
	uc := &EndFocus{
		Focus: fakeFocusRepo{
			end: func(_ context.Context, _ uuid.UUID, _ uuid.UUID, _ time.Time, _ int, _ int) (domain.FocusSession, error) {
				return domain.FocusSession{}, nil
			},
		},
		Streaks:           streak,
		Log:               discardLogger(),
		Now:               fixedNow,
		QualifyingSeconds: 42,
	}
	_, _ = uc.Do(context.Background(), EndFocusInput{UserID: uuid.New(), SessionID: uuid.New()})
	if streak.applyCalls[0].threshold != 42 {
		t.Fatalf("threshold = %d, want 42", streak.applyCalls[0].threshold)
	}
}

// ─── GetStats ──────────────────────────────────────────────────────────────

func TestGetStats_ComputesTotalAndLastSeven(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	to := fixedNow().UTC().Truncate(24 * time.Hour)
	// 10 days: oldest 5 outside the 7-day window, newest 5 inside + today.
	days := make([]domain.StreakDay, 10)
	for i := 0; i < 10; i++ {
		days[i] = domain.StreakDay{
			Day:            to.AddDate(0, 0, -(9 - i)),
			FocusedSeconds: (i + 1) * 100,
			SessionsCount:  1,
		}
	}
	uc := &GetStats{
		Streaks: &fakeStreakRepo{
			getState:  func(_ context.Context, _ uuid.UUID) (domain.StreakState, error) { return domain.StreakState{CurrentStreak: 3, LongestStreak: 7}, nil },
			rangeDays: func(_ context.Context, _ uuid.UUID, _, _ time.Time) ([]domain.StreakDay, error) { return days, nil },
		},
		Now: fixedNow,
	}
	got, err := uc.Do(context.Background(), GetStatsInput{UserID: uid})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.CurrentStreakDays != 3 || got.LongestStreakDays != 7 {
		t.Errorf("state didn't propagate: current=%d longest=%d", got.CurrentStreakDays, got.LongestStreakDays)
	}
	// Total = sum(100..1000) = 5500
	if got.TotalFocusedSecs != 5500 {
		t.Errorf("total = %d, want 5500", got.TotalFocusedSecs)
	}
	if len(got.Heatmap) != 10 {
		t.Errorf("heatmap len = %d, want 10", len(got.Heatmap))
	}
	if len(got.LastSevenDays) != 7 {
		t.Errorf("last-seven len = %d, want 7", len(got.LastSevenDays))
	}
	// Last-seven must contain the newest 7 entries.
	if !got.LastSevenDays[0].Day.Equal(to.AddDate(0, 0, -6)) {
		t.Errorf("last-seven[0].day = %v, want %v", got.LastSevenDays[0].Day, to.AddDate(0, 0, -6))
	}
}
