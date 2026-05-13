package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/tutor/domain"
	"druz9/tutor/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ── ListReadingPaths ─────────────────────────────────────────────────

func TestListReadingPaths_NilTutor(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := &ListReadingPaths{Repo: mocks.NewMockReadingPathRepo(ctrl)}
	_, err := uc.Do(context.Background(), uuid.Nil, 50, "")
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestListReadingPaths_NilRepo_ReturnsEmpty(t *testing.T) {
	// Defensive: degraded boot path that fails to wire repo should
	// surface as an empty list, not a crash on the UI.
	uc := &ListReadingPaths{Repo: nil}
	out, err := uc.Do(context.Background(), uuid.New(), 50, "")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(out.Items) != 0 || out.NextCursor != "" {
		t.Fatalf("expected empty output, got %+v", out)
	}
}

func TestListReadingPaths_Happy(t *testing.T) {
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	want := []domain.ReadingPath{
		{ID: uuid.New(), TutorID: tutorID, Name: "Senior Go basics"},
	}
	repo := mocks.NewMockReadingPathRepo(ctrl)
	repo.EXPECT().ListReadingPathsByTutorPaged(gomock.Any(), tutorID, gomock.Any(), gomock.Any()).Return(want, "cursor-2", nil)
	uc := &ListReadingPaths{Repo: repo}
	out, err := uc.Do(context.Background(), tutorID, 50, "")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(out.Items) != 1 || out.NextCursor != "cursor-2" {
		t.Fatalf("unexpected output: %+v", out)
	}
}

// ── CreateReadingPath ────────────────────────────────────────────────

func TestCreateReadingPath_Validation(t *testing.T) {
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	cases := []struct {
		name string
		in   CreateReadingPathInput
	}{
		{"nil tutor", CreateReadingPathInput{Name: "x"}},
		{"empty name", CreateReadingPathInput{TutorID: tutorID, Name: "   "}},
		{"too many nodes", CreateReadingPathInput{
			TutorID:       tutorID,
			Name:          "x",
			AtlasNodeKeys: make([]string, domain.ReadingPathMaxNodes+1),
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			uc := &CreateReadingPath{Repo: mocks.NewMockReadingPathRepo(ctrl)}
			_, err := uc.Do(context.Background(), c.in)
			if !errors.Is(err, domain.ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
	}
}

func TestCreateReadingPath_DedupesAndTrims(t *testing.T) {
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	now := time.Date(2026, 5, 12, 10, 0, 0, 0, time.UTC)
	var saved domain.ReadingPath
	repo := mocks.NewMockReadingPathRepo(ctrl)
	repo.EXPECT().CreateReadingPath(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, p domain.ReadingPath) (domain.ReadingPath, error) {
			saved = p
			p.ID = uuid.New()
			return p, nil
		},
	)
	uc := &CreateReadingPath{
		Now:  func() time.Time { return now },
		Repo: repo,
	}
	res, err := uc.Do(context.Background(), CreateReadingPathInput{
		TutorID:       tutorID,
		Name:          "  Senior Go basics  ",
		Description:   "  intro for new students  ",
		AtlasNodeKeys: []string{"go.routines", "", "go.channels", "go.routines"}, // dup + empty
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if res.ID == uuid.Nil {
		t.Fatalf("expected id back from repo")
	}
	if saved.Name != "Senior Go basics" {
		t.Fatalf("expected trimmed name, got %q", saved.Name)
	}
	if saved.Description != "intro for new students" {
		t.Fatalf("expected trimmed description, got %q", saved.Description)
	}
	if len(saved.AtlasNodeKeys) != 2 || saved.AtlasNodeKeys[0] != "go.routines" || saved.AtlasNodeKeys[1] != "go.channels" {
		t.Fatalf("expected dedupe to keep order, got %v", saved.AtlasNodeKeys)
	}
	if !saved.CreatedAt.Equal(now) || !saved.UpdatedAt.Equal(now) {
		t.Fatalf("expected timestamps from injected clock")
	}
}

// ── UpdateReadingPath ────────────────────────────────────────────────

func TestUpdateReadingPath_NilIDs(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := &UpdateReadingPath{Repo: mocks.NewMockReadingPathRepo(ctrl)}
	_, err := uc.Do(context.Background(), UpdateReadingPathInput{Name: "x"})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestUpdateReadingPath_PassesThrough(t *testing.T) {
	ctrl := gomock.NewController(t)
	tutorID, pathID := uuid.New(), uuid.New()
	var got domain.ReadingPath
	repo := mocks.NewMockReadingPathRepo(ctrl)
	repo.EXPECT().UpdateReadingPath(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, p domain.ReadingPath) (domain.ReadingPath, error) {
			got = p
			return p, nil
		},
	)
	uc := &UpdateReadingPath{Repo: repo}
	_, err := uc.Do(context.Background(), UpdateReadingPathInput{
		TutorID: tutorID,
		PathID:  pathID,
		Name:    "renamed",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.TutorID != tutorID || got.ID != pathID || got.Name != "renamed" {
		t.Fatalf("unexpected forwarded path: %+v", got)
	}
}

// ── ArchiveReadingPath ───────────────────────────────────────────────

func TestArchiveReadingPath_Forwards(t *testing.T) {
	ctrl := gomock.NewController(t)
	tutorID, pathID := uuid.New(), uuid.New()
	now := time.Date(2026, 5, 12, 11, 0, 0, 0, time.UTC)
	called := false
	repo := mocks.NewMockReadingPathRepo(ctrl)
	repo.EXPECT().ArchiveReadingPath(gomock.Any(), tutorID, pathID, gomock.Any()).DoAndReturn(
		func(_ context.Context, _, _ uuid.UUID, ts time.Time) error {
			called = true
			if !ts.Equal(now) {
				return errors.New("wrong timestamp")
			}
			return nil
		},
	)
	uc := &ArchiveReadingPath{
		Now:  func() time.Time { return now },
		Repo: repo,
	}
	if err := uc.Do(context.Background(), ArchiveReadingPathInput{TutorID: tutorID, PathID: pathID}); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !called {
		t.Fatalf("expected archive to be invoked")
	}
}
