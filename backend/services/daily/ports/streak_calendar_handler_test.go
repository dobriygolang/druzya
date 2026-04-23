// Tests for the chi-mounted /api/v1/kata/streak handler.
package ports

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"druz9/daily/app"
	"druz9/daily/domain"
	"druz9/daily/domain/mocks"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newStreakCalendarHandler(t *testing.T, ctrl *gomock.Controller, now time.Time) (*StreakCalendarHandler, *mocks.MockStreakRepo, *mocks.MockKataRepo) {
	t.Helper()
	streaks := mocks.NewMockStreakRepo(ctrl)
	katas := mocks.NewMockKataRepo(ctrl)
	uc := &app.GetStreakCalendar{Streaks: streaks, Katas: katas, Now: func() time.Time { return now }}
	return NewStreakCalendarHandler(uc, discardLogger()), streaks, katas
}

func TestStreakCalendarHandler_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	now := time.Date(2026, 4, 22, 12, 0, 0, 0, time.UTC)
	h, streaks, katas := newStreakCalendarHandler(t, ctrl, now)
	uid := uuid.New()

	pass := true
	streaks.EXPECT().Get(gomock.Any(), uid).Return(
		domain.StreakState{CurrentStreak: 5, LongestStreak: 10, FreezeTokens: 2}, nil)
	katas.EXPECT().HistoryByYear(gomock.Any(), uid, 2026).Return(
		[]domain.HistoryEntry{
			{Date: time.Date(2026, time.April, 20, 0, 0, 0, 0, time.UTC), Passed: &pass},
		}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/kata/streak?year=2026", nil)
	req = req.WithContext(sharedMw.WithUserID(req.Context(), uid))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if body["year"].(float64) != 2026 {
		t.Fatalf("year=%v", body["year"])
	}
	if body["current"].(float64) != 5 {
		t.Fatalf("current=%v", body["current"])
	}
	months, ok := body["months"].([]any)
	if !ok || len(months) != 12 {
		t.Fatalf("months malformed: %v", body["months"])
	}
}

func TestStreakCalendarHandler_DefaultsToCurrentYear(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	now := time.Date(2026, 4, 22, 12, 0, 0, 0, time.UTC)
	h, streaks, katas := newStreakCalendarHandler(t, ctrl, now)
	uid := uuid.New()

	streaks.EXPECT().Get(gomock.Any(), uid).Return(domain.StreakState{}, nil)
	katas.EXPECT().HistoryByYear(gomock.Any(), uid, 2026).Return(nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/kata/streak", nil)
	req = req.WithContext(sharedMw.WithUserID(req.Context(), uid))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d", w.Code)
	}
}

func TestStreakCalendarHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	now := time.Date(2026, 4, 22, 0, 0, 0, 0, time.UTC)
	h, _, _ := newStreakCalendarHandler(t, ctrl, now)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/kata/streak", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401", w.Code)
	}
}

func TestStreakCalendarHandler_InvalidYear(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	now := time.Date(2026, 4, 22, 0, 0, 0, 0, time.UTC)
	h, _, _ := newStreakCalendarHandler(t, ctrl, now)
	uid := uuid.New()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/kata/streak?year=abc", nil)
	req = req.WithContext(sharedMw.WithUserID(req.Context(), uid))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", w.Code)
	}
}

func TestStreakCalendarHandler_OutOfRangeYear(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	now := time.Date(2026, 4, 22, 0, 0, 0, 0, time.UTC)
	h, _, _ := newStreakCalendarHandler(t, ctrl, now)
	uid := uuid.New()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/kata/streak?year=1500", nil)
	req = req.WithContext(sharedMw.WithUserID(req.Context(), uid))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", w.Code)
	}
}

func TestStreakCalendarHandler_MethodNotAllowed(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	now := time.Date(2026, 4, 22, 0, 0, 0, 0, time.UTC)
	h, _, _ := newStreakCalendarHandler(t, ctrl, now)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/kata/streak", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d, want 405", w.Code)
	}
}
