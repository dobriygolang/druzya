package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// fakeSnapshotRepo is a hand-rolled fake — there's no mockgen target
// for SnapshotRepo (the directive on repo.go covers Repo only). Two
// closures satisfy the two interface methods; nil = unimplemented
// fail (a test that hits a missing closure fails loudly).
type fakeSnapshotRepo struct {
	ensure   func(ctx context.Context, tutorID, studentID uuid.UUID) error
	snapshot func(ctx context.Context, studentID uuid.UUID, w int, now time.Time) (domain.StudentSnapshot, error)
}

func (f fakeSnapshotRepo) EnsureRelationship(ctx context.Context, tutorID, studentID uuid.UUID) error {
	if f.ensure == nil {
		return errors.New("ensure not set")
	}
	return f.ensure(ctx, tutorID, studentID)
}

func (f fakeSnapshotRepo) GetStudentSnapshot(ctx context.Context, studentID uuid.UUID, w int, now time.Time) (domain.StudentSnapshot, error) {
	if f.snapshot == nil {
		return domain.StudentSnapshot{}, errors.New("snapshot not set")
	}
	return f.snapshot(ctx, studentID, w, now)
}

func TestGetStudentSnapshot_HappyPath(t *testing.T) {
	t.Parallel()
	tutorID := uuid.New()
	studentID := uuid.New()

	want := domain.StudentSnapshot{
		StudentID:            studentID,
		WindowDays:           7,
		FocusMinutesWindow:   180,
		FocusSessionsCount:   8,
		EnglishMocksCount:    3,
		EnglishMocksAvgScore: 71,
		WeakSpots: []domain.WeakSpot{
			{NodeKey: "eng_read_tech", Title: "Reading: tech", Progress: 25},
		},
	}
	repo := fakeSnapshotRepo{
		ensure: func(_ context.Context, tID, sID uuid.UUID) error {
			if tID != tutorID || sID != studentID {
				t.Errorf("ensure called with wrong ids: %v / %v", tID, sID)
			}
			return nil
		},
		snapshot: func(_ context.Context, sID uuid.UUID, w int, _ time.Time) (domain.StudentSnapshot, error) {
			if sID != studentID {
				t.Errorf("snapshot called with wrong studentID: %v", sID)
			}
			if w != 7 {
				t.Errorf("expected default window=7, got %d", w)
			}
			return want, nil
		},
	}
	uc := &GetStudentSnapshot{Repo: repo}
	got, err := uc.Do(context.Background(), GetStudentSnapshotInput{TutorID: tutorID, StudentID: studentID})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if got.FocusMinutesWindow != want.FocusMinutesWindow {
		t.Errorf("focus = %d, want %d", got.FocusMinutesWindow, want.FocusMinutesWindow)
	}
	if len(got.WeakSpots) != 1 || got.WeakSpots[0].NodeKey != "eng_read_tech" {
		t.Errorf("weak spots round-trip broken: %+v", got.WeakSpots)
	}
}

func TestGetStudentSnapshot_AuthGate_PreventsForeignProbe(t *testing.T) {
	t.Parallel()
	called := false
	repo := fakeSnapshotRepo{
		ensure: func(_ context.Context, _, _ uuid.UUID) error {
			return domain.ErrNotFound // simulate «no active relationship»
		},
		snapshot: func(_ context.Context, _ uuid.UUID, _ int, _ time.Time) (domain.StudentSnapshot, error) {
			called = true
			return domain.StudentSnapshot{}, nil
		},
	}
	uc := &GetStudentSnapshot{Repo: repo}
	_, err := uc.Do(context.Background(), GetStudentSnapshotInput{TutorID: uuid.New(), StudentID: uuid.New()})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
	if called {
		t.Error("snapshot must NOT be fetched when ensure fails — that's the leak protection")
	}
}

func TestGetStudentSnapshot_RejectsZeroIDs(t *testing.T) {
	t.Parallel()
	uc := &GetStudentSnapshot{Repo: fakeSnapshotRepo{}}
	_, err := uc.Do(context.Background(), GetStudentSnapshotInput{TutorID: uuid.Nil, StudentID: uuid.New()})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("zero tutor must be ErrInvalidInput, got %v", err)
	}
	_, err = uc.Do(context.Background(), GetStudentSnapshotInput{TutorID: uuid.New(), StudentID: uuid.Nil})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("zero student must be ErrInvalidInput, got %v", err)
	}
}

// fakeBriefer renders a placeholder using the snapshot — enough to
// confirm wiring without dragging an LLM into the test.
type fakeBriefer struct {
	out string
	err error
}

func (f fakeBriefer) Render(_ context.Context, _ domain.StudentSnapshot) (string, error) {
	return f.out, f.err
}

func TestGeneratePreSessionBrief_NoBrieferReturnsSnapshotOnly(t *testing.T) {
	t.Parallel()
	tutorID := uuid.New()
	studentID := uuid.New()
	repo := fakeSnapshotRepo{
		ensure: func(_ context.Context, _, _ uuid.UUID) error { return nil },
		snapshot: func(_ context.Context, _ uuid.UUID, _ int, _ time.Time) (domain.StudentSnapshot, error) {
			return domain.StudentSnapshot{StudentID: studentID, FocusMinutesWindow: 100}, nil
		},
	}
	uc := &GeneratePreSessionBrief{
		Snapshot: &GetStudentSnapshot{Repo: repo},
		Briefer:  nil, // <- no LLM
	}
	out, err := uc.Do(context.Background(), GetStudentSnapshotInput{TutorID: tutorID, StudentID: studentID})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.Brief != "" {
		t.Errorf("brief must be empty when Briefer nil, got %q", out.Brief)
	}
	if out.Snapshot.FocusMinutesWindow != 100 {
		t.Errorf("snapshot must still propagate, got %+v", out.Snapshot)
	}
}

func TestGeneratePreSessionBrief_BrieferErrorIsNonFatal(t *testing.T) {
	t.Parallel()
	repo := fakeSnapshotRepo{
		ensure: func(_ context.Context, _, _ uuid.UUID) error { return nil },
		snapshot: func(_ context.Context, _ uuid.UUID, _ int, _ time.Time) (domain.StudentSnapshot, error) {
			return domain.StudentSnapshot{FocusMinutesWindow: 50}, nil
		},
	}
	uc := &GeneratePreSessionBrief{
		Snapshot: &GetStudentSnapshot{Repo: repo},
		Briefer:  fakeBriefer{err: errors.New("groq quota exhausted")},
	}
	out, err := uc.Do(context.Background(), GetStudentSnapshotInput{TutorID: uuid.New(), StudentID: uuid.New()})
	if err != nil {
		t.Fatalf("LLM error must not be fatal — dashboard still needs the snapshot. got %v", err)
	}
	if out.Brief != "" {
		t.Errorf("on LLM error brief must be empty, got %q", out.Brief)
	}
	if out.Snapshot.FocusMinutesWindow != 50 {
		t.Errorf("snapshot must propagate even when LLM failed: %+v", out.Snapshot)
	}
}

func TestGeneratePreSessionBrief_HappyPath(t *testing.T) {
	t.Parallel()
	repo := fakeSnapshotRepo{
		ensure: func(_ context.Context, _, _ uuid.UUID) error { return nil },
		snapshot: func(_ context.Context, _ uuid.UUID, _ int, _ time.Time) (domain.StudentSnapshot, error) {
			return domain.StudentSnapshot{FocusMinutesWindow: 200}, nil
		},
	}
	const briefText = "Маша провела 200 минут focus-сессий..."
	uc := &GeneratePreSessionBrief{
		Snapshot: &GetStudentSnapshot{Repo: repo},
		Briefer:  fakeBriefer{out: briefText},
	}
	out, err := uc.Do(context.Background(), GetStudentSnapshotInput{TutorID: uuid.New(), StudentID: uuid.New()})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.Brief != briefText {
		t.Errorf("brief mismatch: got %q want %q", out.Brief, briefText)
	}
}
