package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/hone/domain"
	"druz9/hone/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ─── StartFocus ────────────────────────────────────────────────────────────

func TestStartFocus_DefaultsMode(t *testing.T) {
	t.Parallel()
	// Invalid / empty mode input defaults to pomodoro rather than rejecting —
	// the client may forget to set the field, a timer is still a timer.
	ctrl := gomock.NewController(t)
	var got domain.FocusSession
	focus := mocks.NewMockFocusRepo(ctrl)
	focus.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, s domain.FocusSession) (domain.FocusSession, error) {
			got = s
			s.ID = uuid.New()
			return s, nil
		},
	)
	uc := &StartFocus{
		Focus: focus,
		Log:   discardLogger(),
		Now:   fixedNow,
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
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	sid := uuid.New()
	nowUTC := fixedNow().UTC()
	focus := mocks.NewMockFocusRepo(ctrl)
	focus.EXPECT().End(gomock.Any(), uid, sid, gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.FocusSession{ID: sid, UserID: uid, EndedAt: &nowUTC}, nil,
	)

	streak := mocks.NewMockStreakRepo(ctrl)
	type applyCall struct {
		day       time.Time
		seconds   int
		threshold int
	}
	var applyCalls []applyCall
	streak.EXPECT().ApplyFocusSession(gomock.Any(), uid, gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, day time.Time, sd, _, th int) (domain.StreakState, error) {
			applyCalls = append(applyCalls, applyCall{day: day, seconds: sd, threshold: th})
			return domain.StreakState{CurrentStreak: 1}, nil
		},
	)

	uc := &EndFocus{
		Focus:   focus,
		Streaks: streak,
		Log:     discardLogger(),
		Now:     fixedNow,
	}
	_, err := uc.Do(context.Background(), EndFocusInput{UserID: uid, SessionID: sid, SecondsFocused: 1500, PomodorosCompleted: 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(applyCalls) != 1 {
		t.Fatalf("ApplyFocusSession called %d times, want 1", len(applyCalls))
	}
	got := applyCalls[0]
	if got.seconds != 1500 {
		t.Errorf("seconds delta = %d, want 1500", got.seconds)
	}
	if got.threshold != MinQualifyingFocusSeconds {
		t.Errorf("threshold = %d, want default %d", got.threshold, MinQualifyingFocusSeconds)
	}
	if !got.day.Equal(nowUTC.Truncate(24 * time.Hour)) {
		t.Errorf("day = %v, want %v", got.day, nowUTC.Truncate(24*time.Hour))
	}
}

func TestEndFocus_DoesNotFailWhenStreakApplyErrors(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	// Streak aggregate is eventually-consistent: if the post-End streak
	// update fails (Redis stall, transient PG flake), the session itself
	// is already stored and the user should see the "you focused" path
	// complete. Reconciliation is the streak worker's problem, not the UC.
	focus := mocks.NewMockFocusRepo(ctrl)
	focus.EXPECT().End(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.FocusSession{}, nil,
	)
	streak := mocks.NewMockStreakRepo(ctrl)
	streak.EXPECT().ApplyFocusSession(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.StreakState{}, errors.New("transient"),
	)
	uc := &EndFocus{
		Focus:   focus,
		Streaks: streak,
		Log:     discardLogger(),
		Now:     fixedNow,
	}
	// SecondsFocused>=60 чтобы пройти insta-stop фильтр и вызвать ApplyFocusSession.
	if _, err := uc.Do(context.Background(), EndFocusInput{UserID: uuid.New(), SessionID: uuid.New(), SecondsFocused: 60}); err != nil {
		t.Fatalf("End should succeed even when streak apply fails; got %v", err)
	}
}

func TestEndFocus_ReflectionCreatesNote(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	sid := uuid.New()
	focus := mocks.NewMockFocusRepo(ctrl)
	focus.EXPECT().End(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, _ uuid.UUID, _ time.Time, _, secs int) (domain.FocusSession, error) {
			return domain.FocusSession{ID: sid, UserID: uid, PinnedTitle: "BFS on trees", SecondsFocused: secs}, nil
		},
	)
	streak := mocks.NewMockStreakRepo(ctrl)
	streak.EXPECT().ApplyFocusSession(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.StreakState{}, nil)

	notes := mocks.NewMockNoteRepo(ctrl)
	var created []domain.Note
	notes.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, n domain.Note) (domain.Note, error) {
			n.ID = uuid.New()
			created = append(created, n)
			return n, nil
		},
	)

	uc := &EndFocus{
		Focus:   focus,
		Streaks: streak,
		Notes:   notes,
		Log:     discardLogger(),
		Now:     fixedNow,
	}
	_, err := uc.Do(context.Background(), EndFocusInput{
		UserID: uid, SessionID: sid, SecondsFocused: 1500, PomodorosCompleted: 1,
		Reflection: "Understood the algorithm, need to redo it from scratch tomorrow",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(created) != 1 {
		t.Fatalf("expected 1 reflection note, got %d", len(created))
	}
	if !strings.Contains(created[0].Title, "BFS on trees") {
		t.Errorf("note title = %q", created[0].Title)
	}
	if !strings.Contains(created[0].BodyMD, "Understood the algorithm") {
		t.Errorf("note body missing reflection")
	}
}

func TestEndFocus_EmptyReflection_NoNote(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	focus := mocks.NewMockFocusRepo(ctrl)
	focus.EXPECT().End(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.FocusSession{}, nil,
	)
	streak := mocks.NewMockStreakRepo(ctrl)
	streak.EXPECT().ApplyFocusSession(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.StreakState{}, nil)
	notes := mocks.NewMockNoteRepo(ctrl)
	// notes.Create should NOT be called when reflection is empty (gomock will
	// auto-fail on unexpected calls, validating the no-note assertion).
	uc := &EndFocus{
		Focus:   focus,
		Streaks: streak,
		Notes:   notes,
		Log:     discardLogger(),
		Now:     fixedNow,
	}
	// SecondsFocused>=60 чтобы пройти insta-stop фильтр и вызвать ApplyFocusSession.
	_, err := uc.Do(context.Background(), EndFocusInput{UserID: uuid.New(), SessionID: uuid.New(), SecondsFocused: 60})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
}

func TestEndFocus_UsesCustomQualifyingSecondsWhenSet(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	focus := mocks.NewMockFocusRepo(ctrl)
	focus.EXPECT().End(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.FocusSession{}, nil,
	)
	streak := mocks.NewMockStreakRepo(ctrl)
	var gotThreshold int
	streak.EXPECT().ApplyFocusSession(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, _ time.Time, _, _, th int) (domain.StreakState, error) {
			gotThreshold = th
			return domain.StreakState{}, nil
		},
	)
	uc := &EndFocus{
		Focus:             focus,
		Streaks:           streak,
		Log:               discardLogger(),
		Now:               fixedNow,
		QualifyingSeconds: 42,
	}
	// SecondsFocused>=60 чтобы пройти через insta-stop фильтр в EndFocus.Do.
	// Сессии короче минуты не вызывают ApplyFocusSession (см. focus.go).
	_, _ = uc.Do(context.Background(), EndFocusInput{UserID: uuid.New(), SessionID: uuid.New(), SecondsFocused: 60})
	if gotThreshold != 42 {
		t.Fatalf("threshold = %d, want 42", gotThreshold)
	}
}

// ─── GetStats ──────────────────────────────────────────────────────────────

func TestGetStats_ComputesTotalAndLastSeven(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
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
	streak := mocks.NewMockStreakRepo(ctrl)
	streak.EXPECT().GetState(gomock.Any(), gomock.Any()).Return(domain.StreakState{CurrentStreak: 3, LongestStreak: 7}, nil)
	streak.EXPECT().RangeDays(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(days, nil)
	uc := &GetStats{
		Streaks: streak,
		Now:     fixedNow,
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
