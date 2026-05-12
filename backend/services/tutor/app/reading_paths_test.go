package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// fakeReadingPathRepo follows the same hand-rolled fake convention used
// by fakeAssignmentRepo / fakeSnapshotRepo in this package. Nil closure
// = «not expected to be called» — surfaced as an explicit error so the
// failing test pinpoints the misconfigured field.
type fakeReadingPathRepo struct {
	create   func(ctx context.Context, p domain.ReadingPath) (domain.ReadingPath, error)
	update   func(ctx context.Context, p domain.ReadingPath) (domain.ReadingPath, error)
	archive  func(ctx context.Context, t, p uuid.UUID, now time.Time) error
	listPage func(ctx context.Context, t uuid.UUID, limit int, cursor string) ([]domain.ReadingPath, string, error)
	get      func(ctx context.Context, t, p uuid.UUID) (domain.ReadingPath, error)
}

func (f fakeReadingPathRepo) CreateReadingPath(ctx context.Context, p domain.ReadingPath) (domain.ReadingPath, error) {
	if f.create == nil {
		return domain.ReadingPath{}, errors.New("create not set")
	}
	return f.create(ctx, p)
}
func (f fakeReadingPathRepo) UpdateReadingPath(ctx context.Context, p domain.ReadingPath) (domain.ReadingPath, error) {
	if f.update == nil {
		return domain.ReadingPath{}, errors.New("update not set")
	}
	return f.update(ctx, p)
}
func (f fakeReadingPathRepo) ArchiveReadingPath(ctx context.Context, t, p uuid.UUID, now time.Time) error {
	if f.archive == nil {
		return errors.New("archive not set")
	}
	return f.archive(ctx, t, p, now)
}
func (f fakeReadingPathRepo) ListReadingPathsByTutorPaged(ctx context.Context, t uuid.UUID, limit int, cursor string) ([]domain.ReadingPath, string, error) {
	if f.listPage == nil {
		return nil, "", errors.New("listPage not set")
	}
	return f.listPage(ctx, t, limit, cursor)
}
func (f fakeReadingPathRepo) GetReadingPathForTutor(ctx context.Context, t, p uuid.UUID) (domain.ReadingPath, error) {
	if f.get == nil {
		return domain.ReadingPath{}, errors.New("get not set")
	}
	return f.get(ctx, t, p)
}

// ── ListReadingPaths ─────────────────────────────────────────────────

func TestListReadingPaths_NilTutor(t *testing.T) {
	uc := &ListReadingPaths{Repo: fakeReadingPathRepo{}}
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
	tutorID := uuid.New()
	want := []domain.ReadingPath{
		{ID: uuid.New(), TutorID: tutorID, Name: "Senior Go basics"},
	}
	uc := &ListReadingPaths{Repo: fakeReadingPathRepo{
		listPage: func(_ context.Context, tid uuid.UUID, _ int, _ string) ([]domain.ReadingPath, string, error) {
			if tid != tutorID {
				t.Fatalf("wrong tutor id: got %v want %v", tid, tutorID)
			}
			return want, "cursor-2", nil
		},
	}}
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
			uc := &CreateReadingPath{Repo: fakeReadingPathRepo{}}
			_, err := uc.Do(context.Background(), c.in)
			if !errors.Is(err, domain.ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
	}
}

func TestCreateReadingPath_DedupesAndTrims(t *testing.T) {
	tutorID := uuid.New()
	now := time.Date(2026, 5, 12, 10, 0, 0, 0, time.UTC)
	var saved domain.ReadingPath
	uc := &CreateReadingPath{
		Now: func() time.Time { return now },
		Repo: fakeReadingPathRepo{
			create: func(_ context.Context, p domain.ReadingPath) (domain.ReadingPath, error) {
				saved = p
				p.ID = uuid.New()
				return p, nil
			},
		},
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
	uc := &UpdateReadingPath{Repo: fakeReadingPathRepo{}}
	_, err := uc.Do(context.Background(), UpdateReadingPathInput{Name: "x"})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestUpdateReadingPath_PassesThrough(t *testing.T) {
	tutorID, pathID := uuid.New(), uuid.New()
	var got domain.ReadingPath
	uc := &UpdateReadingPath{
		Repo: fakeReadingPathRepo{
			update: func(_ context.Context, p domain.ReadingPath) (domain.ReadingPath, error) {
				got = p
				return p, nil
			},
		},
	}
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
	tutorID, pathID := uuid.New(), uuid.New()
	now := time.Date(2026, 5, 12, 11, 0, 0, 0, time.UTC)
	called := false
	uc := &ArchiveReadingPath{
		Now: func() time.Time { return now },
		Repo: fakeReadingPathRepo{
			archive: func(_ context.Context, t, p uuid.UUID, ts time.Time) error {
				called = true
				if t != tutorID || p != pathID || !ts.Equal(now) {
					return errors.New("wrong args")
				}
				return nil
			},
		},
	}
	if err := uc.Do(context.Background(), ArchiveReadingPathInput{TutorID: tutorID, PathID: pathID}); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !called {
		t.Fatalf("expected archive to be invoked")
	}
}
