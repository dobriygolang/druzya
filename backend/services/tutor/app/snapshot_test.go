package app

import (
	"context"
	"errors"
	"testing"

	"druz9/tutor/domain"
	"druz9/tutor/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestGetStudentSnapshot_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
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
	repo := mocks.NewMockSnapshotRepo(ctrl)
	repo.EXPECT().EnsureRelationship(gomock.Any(), tutorID, studentID).Return(nil)
	repo.EXPECT().GetStudentSnapshot(gomock.Any(), studentID, 7, gomock.Any()).Return(want, nil)
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
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockSnapshotRepo(ctrl)
	repo.EXPECT().EnsureRelationship(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.ErrNotFound)
	// No EXPECT for GetStudentSnapshot — that's the leak protection assertion.
	uc := &GetStudentSnapshot{Repo: repo}
	_, err := uc.Do(context.Background(), GetStudentSnapshotInput{TutorID: uuid.New(), StudentID: uuid.New()})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestGetStudentSnapshot_RejectsZeroIDs(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &GetStudentSnapshot{Repo: mocks.NewMockSnapshotRepo(ctrl)}
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
// confirm wiring without dragging an LLM into the test. PreSessionBriefer
// lives in the app package, so an inline stub stays here rather than
// generating an app-level mock for this single test usage.
type fakeBriefer struct {
	out string
	err error
}

func (f fakeBriefer) Render(_ context.Context, _ domain.StudentSnapshot) (string, error) {
	return f.out, f.err
}

func TestGeneratePreSessionBrief_NoBrieferReturnsSnapshotOnly(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	studentID := uuid.New()
	repo := mocks.NewMockSnapshotRepo(ctrl)
	repo.EXPECT().EnsureRelationship(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	repo.EXPECT().GetStudentSnapshot(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.StudentSnapshot{StudentID: studentID, FocusMinutesWindow: 100}, nil,
	)
	uc := &GeneratePreSessionBrief{
		Snapshot: &GetStudentSnapshot{Repo: repo},
		Briefer:  nil, // <- no LLM
	}
	out, err := uc.Do(context.Background(), GetStudentSnapshotInput{TutorID: uuid.New(), StudentID: studentID})
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
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockSnapshotRepo(ctrl)
	repo.EXPECT().EnsureRelationship(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	repo.EXPECT().GetStudentSnapshot(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.StudentSnapshot{FocusMinutesWindow: 50}, nil,
	)
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
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockSnapshotRepo(ctrl)
	repo.EXPECT().EnsureRelationship(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	repo.EXPECT().GetStudentSnapshot(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.StudentSnapshot{FocusMinutesWindow: 200}, nil,
	)
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
