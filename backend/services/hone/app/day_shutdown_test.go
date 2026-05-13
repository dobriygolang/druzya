package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"druz9/hone/domain"
	"druz9/hone/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestSubmitDayShutdown_TrimsAndUpserts(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	now := time.Date(2026, 5, 14, 21, 12, 0, 0, time.UTC)
	expectedDate := time.Date(2026, 5, 14, 0, 0, 0, 0, time.UTC)

	repo := mocks.NewMockDayShutdownRepo(ctrl)
	repo.EXPECT().Upsert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, s domain.DayShutdown) (domain.DayShutdown, error) {
			// Use case should trim whitespace and normalise the date.
			if s.UserID != uid {
				t.Errorf("UserID=%v, want %v", s.UserID, uid)
			}
			if !s.ShutdownDate.Equal(expectedDate) {
				t.Errorf("ShutdownDate=%v, want %v", s.ShutdownDate, expectedDate)
			}
			if s.Done != "shipped wave 15" {
				t.Errorf("Done=%q (no trim?)", s.Done)
			}
			if s.Pending != "verify e2e" {
				t.Errorf("Pending=%q", s.Pending)
			}
			if s.Tomorrow != "wire daily_brief" {
				t.Errorf("Tomorrow=%q", s.Tomorrow)
			}
			s.ID = uuid.New()
			return s, nil
		},
	)

	uc := &SubmitDayShutdown{
		Repo: repo,
		Log:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:  func() time.Time { return now },
	}
	out, err := uc.Do(context.Background(), SubmitDayShutdownInput{
		UserID:   uid,
		Done:     "  shipped wave 15  ",
		Pending:  "verify e2e\n",
		Tomorrow: "wire daily_brief",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if out.Shutdown.ID == uuid.Nil {
		t.Error("expected hydrated ID")
	}
}

func TestSubmitDayShutdown_EmptyRejected(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &SubmitDayShutdown{
		Repo: mocks.NewMockDayShutdownRepo(ctrl),
		Log:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:  time.Now,
	}
	_, err := uc.Do(context.Background(), SubmitDayShutdownInput{
		UserID:   uuid.New(),
		Done:     "   ",
		Pending:  "",
		Tomorrow: "  ",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput, got %v", err)
	}
}

func TestGetTodayShutdown_NotRecorded(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	now := time.Date(2026, 5, 14, 7, 0, 0, 0, time.UTC)
	today := time.Date(2026, 5, 14, 0, 0, 0, 0, time.UTC)

	repo := mocks.NewMockDayShutdownRepo(ctrl)
	repo.EXPECT().GetForDate(gomock.Any(), uid, today).Return(domain.DayShutdown{}, domain.ErrNotFound)

	uc := &GetTodayShutdown{
		Repo: repo,
		Now:  func() time.Time { return now },
	}
	out, err := uc.Do(context.Background(), uid)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if out.Recorded {
		t.Errorf("expected Recorded=false")
	}
}

func TestGetTodayShutdown_Recorded(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	now := time.Date(2026, 5, 14, 7, 0, 0, 0, time.UTC)
	today := time.Date(2026, 5, 14, 0, 0, 0, 0, time.UTC)

	want := domain.DayShutdown{
		ID:           uuid.New(),
		UserID:       uid,
		ShutdownDate: today,
		Done:         "x",
		Pending:      "y",
		Tomorrow:     "z",
	}
	repo := mocks.NewMockDayShutdownRepo(ctrl)
	repo.EXPECT().GetForDate(gomock.Any(), uid, today).Return(want, nil)

	uc := &GetTodayShutdown{
		Repo: repo,
		Now:  func() time.Time { return now },
	}
	out, err := uc.Do(context.Background(), uid)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !out.Recorded {
		t.Errorf("Recorded=false")
	}
	if out.Shutdown.ID != want.ID {
		t.Errorf("ID mismatch")
	}
}
