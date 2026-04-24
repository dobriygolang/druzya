package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

type fakeBoards struct {
	wb     domain.Whiteboard
	getErr error
}

func (f *fakeBoards) Get(context.Context, uuid.UUID, uuid.UUID) (domain.Whiteboard, error) {
	return f.wb, f.getErr
}
func (f *fakeBoards) Create(context.Context, domain.Whiteboard) (domain.Whiteboard, error) {
	return domain.Whiteboard{}, nil
}
func (f *fakeBoards) Update(context.Context, domain.Whiteboard, int) (domain.Whiteboard, error) {
	return domain.Whiteboard{}, nil
}
func (f *fakeBoards) List(context.Context, uuid.UUID) ([]domain.WhiteboardSummary, error) {
	return nil, nil
}
func (f *fakeBoards) Delete(context.Context, uuid.UUID, uuid.UUID) error { return nil }

func TestSaveCritiqueAsNote_CreatesNoteWithDefaultTitle(t *testing.T) {
	t.Parallel()
	boards := &fakeBoards{wb: domain.Whiteboard{ID: uuid.New(), Title: "Chat system"}}
	notes := &fakeNotes{}

	uc := &SaveCritiqueAsNote{
		Boards: boards,
		Notes:  notes,
		Log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:    func() time.Time { return time.Date(2026, 4, 25, 10, 0, 0, 0, time.UTC) },
	}
	n, err := uc.Do(context.Background(), SaveCritiqueAsNoteInput{
		UserID:       uuid.New(),
		WhiteboardID: uuid.New(),
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
	uc := &SaveCritiqueAsNote{
		Boards: &fakeBoards{},
		Notes:  &fakeNotes{},
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
	boards := &fakeBoards{getErr: domain.ErrNotFound}
	uc := &SaveCritiqueAsNote{
		Boards: boards,
		Notes:  &fakeNotes{},
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
