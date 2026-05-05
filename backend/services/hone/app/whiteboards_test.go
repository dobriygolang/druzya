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

func TestSaveCritiqueAsNote_CreatesNoteWithDefaultTitle(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	wbID := uuid.New()
	uid := uuid.New()
	boards := mocks.NewMockWhiteboardRepo(ctrl)
	boards.EXPECT().Get(gomock.Any(), uid, wbID).Return(domain.Whiteboard{ID: wbID, Title: "Chat system"}, nil)

	notes := mocks.NewMockNoteRepo(ctrl)
	notes.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, n domain.Note) (domain.Note, error) {
			n.ID = uuid.New()
			return n, nil
		},
	)

	uc := &SaveCritiqueAsNote{
		Boards: boards,
		Notes:  notes,
		Log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:    func() time.Time { return time.Date(2026, 4, 25, 10, 0, 0, 0, time.UTC) },
	}
	n, err := uc.Do(context.Background(), SaveCritiqueAsNoteInput{
		UserID:       uid,
		WhiteboardID: wbID,
		Title:        "",
		BodyMD:       "## STRENGTHS\n- clear api",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if n.Title != "Critique: Chat system" {
		t.Errorf("title = %q, want 'Critique: Chat system'", n.Title)
	}
}

func TestSaveCritiqueAsNote_EmptyBodyRejected(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &SaveCritiqueAsNote{
		Boards: mocks.NewMockWhiteboardRepo(ctrl),
		Notes:  mocks.NewMockNoteRepo(ctrl),
		Log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:    time.Now,
	}
	_, err := uc.Do(context.Background(), SaveCritiqueAsNoteInput{
		UserID:       uuid.New(),
		WhiteboardID: uuid.New(),
		BodyMD:       "",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput, got %v", err)
	}
}

func TestSaveCritiqueAsNote_UnknownWhiteboard(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	boards := mocks.NewMockWhiteboardRepo(ctrl)
	boards.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.Whiteboard{}, domain.ErrNotFound)
	uc := &SaveCritiqueAsNote{
		Boards: boards,
		Notes:  mocks.NewMockNoteRepo(ctrl),
		Log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:    time.Now,
	}
	_, err := uc.Do(context.Background(), SaveCritiqueAsNoteInput{
		UserID:       uuid.New(),
		WhiteboardID: uuid.New(),
		BodyMD:       "x",
	})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}
