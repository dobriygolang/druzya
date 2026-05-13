// path_assignments_test.go — Phase K T2+T3 coverage.
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

// ── AssignReadingPath ─────────────────────────────────────────────────

func TestAssignReadingPath_NilIDs(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &AssignReadingPath{
		Paths:           mocks.NewMockReadingPathRepo(ctrl),
		PathAssignments: mocks.NewMockPathAssignmentRepo(ctrl),
		Assignments:     mocks.NewMockAssignmentRepo(ctrl),
	}
	_, err := uc.Do(context.Background(), AssignReadingPathInput{})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestAssignReadingPath_SelfAssign(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	id := uuid.New()
	uc := &AssignReadingPath{
		Paths:           mocks.NewMockReadingPathRepo(ctrl),
		PathAssignments: mocks.NewMockPathAssignmentRepo(ctrl),
		Assignments:     mocks.NewMockAssignmentRepo(ctrl),
	}
	_, err := uc.Do(context.Background(), AssignReadingPathInput{
		TutorID:   id,
		StudentID: id,
		PathID:    uuid.New(),
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestAssignReadingPath_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	studentID := uuid.New()
	pathID := uuid.New()

	path := domain.ReadingPath{
		ID:            pathID,
		TutorID:       tutorID,
		Name:          "Senior Go basics",
		AtlasNodeKeys: []string{"go.routines", "go.channels", "go.scheduler"},
		ResourceIDs:   []uuid.UUID{},
	}

	var createdAssignments []domain.Assignment
	var savedPathAssignment domain.PathAssignment
	pathAssignID := uuid.New()

	paths := mocks.NewMockReadingPathRepo(ctrl)
	paths.EXPECT().GetReadingPathForTutor(gomock.Any(), tutorID, pathID).Return(path, nil)

	pathAssignments := mocks.NewMockPathAssignmentRepo(ctrl)
	pathAssignments.EXPECT().CreatePathAssignment(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, a domain.PathAssignment) (domain.PathAssignment, error) {
			a.ID = pathAssignID
			savedPathAssignment = a
			return a, nil
		},
	)
	pathAssignments.EXPECT().IncrementPathAssignedCount(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()

	assignments := mocks.NewMockAssignmentRepo(ctrl)
	assignments.EXPECT().EnsureRelationship(gomock.Any(), tutorID, studentID).Return(nil)
	assignments.EXPECT().CreateAssignment(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, a domain.Assignment) (domain.Assignment, error) {
			a.ID = uuid.New()
			createdAssignments = append(createdAssignments, a)
			return a, nil
		},
	).AnyTimes()

	uc := &AssignReadingPath{
		Paths:           paths,
		PathAssignments: pathAssignments,
		Assignments:     assignments,
	}

	out, err := uc.Do(context.Background(), AssignReadingPathInput{
		TutorID:   tutorID,
		StudentID: studentID,
		PathID:    pathID,
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if out.AssignmentsCreated != 3 {
		t.Fatalf("expected 3 per-step assignments, got %d", out.AssignmentsCreated)
	}
	if out.Assignment.TotalSteps != 3 {
		t.Fatalf("expected total_steps=3, got %d", out.Assignment.TotalSteps)
	}
	if len(savedPathAssignment.SnapshotAtlasNodeKeys) != 3 {
		t.Fatalf("expected snapshot of 3 keys, got %d", len(savedPathAssignment.SnapshotAtlasNodeKeys))
	}
	if len(createdAssignments) != 3 {
		t.Fatalf("expected 3 per-step TutorAssignment rows, got %d", len(createdAssignments))
	}
	// Step numbering in title: «… step 1/3: …».
	for i, a := range createdAssignments {
		want := path.AtlasNodeKeys[i]
		if !containsAll(a.Title, []string{path.Name, "step", want}) {
			t.Fatalf("step %d title missing pieces: %q", i+1, a.Title)
		}
	}
}

func TestAssignReadingPath_RejectsArchivedPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	pathID := uuid.New()
	archived := time.Now()
	paths := mocks.NewMockReadingPathRepo(ctrl)
	paths.EXPECT().GetReadingPathForTutor(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.ReadingPath{
		ID:            pathID,
		TutorID:       tutorID,
		AtlasNodeKeys: []string{"x"},
		ArchivedAt:    &archived,
	}, nil)
	uc := &AssignReadingPath{
		Paths:           paths,
		PathAssignments: mocks.NewMockPathAssignmentRepo(ctrl),
		Assignments:     mocks.NewMockAssignmentRepo(ctrl),
	}
	_, err := uc.Do(context.Background(), AssignReadingPathInput{
		TutorID:   tutorID,
		StudentID: uuid.New(),
		PathID:    pathID,
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for archived path, got %v", err)
	}
}

func TestAssignReadingPath_RejectsEmptyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	paths := mocks.NewMockReadingPathRepo(ctrl)
	paths.EXPECT().GetReadingPathForTutor(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.ReadingPath{ID: uuid.New(), TutorID: tutorID}, nil)
	uc := &AssignReadingPath{
		Paths:           paths,
		PathAssignments: mocks.NewMockPathAssignmentRepo(ctrl),
		Assignments:     mocks.NewMockAssignmentRepo(ctrl),
	}
	_, err := uc.Do(context.Background(), AssignReadingPathInput{
		TutorID:   tutorID,
		StudentID: uuid.New(),
		PathID:    uuid.New(),
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

// ── ListMyActivePathAssignments ───────────────────────────────────────

func TestListMyActivePathAssignments_NilStudent(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &ListMyActivePathAssignments{Repo: mocks.NewMockPathAssignmentRepo(ctrl)}
	_, err := uc.Do(context.Background(), uuid.Nil)
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestListMyActivePathAssignments_NilRepo_ReturnsEmpty(t *testing.T) {
	t.Parallel()
	uc := &ListMyActivePathAssignments{Repo: nil}
	out, err := uc.Do(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(out) != 0 {
		t.Fatalf("expected empty, got %d", len(out))
	}
}

// ── AdvancePathStep ───────────────────────────────────────────────────

func TestAdvancePathStep_NilIDs(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &AdvancePathStep{Repo: mocks.NewMockPathAssignmentRepo(ctrl)}
	_, err := uc.Do(context.Background(), AdvancePathStepInput{})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestAdvancePathStep_AlreadyCompleted_NoError(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	completed := time.Now()
	repo := mocks.NewMockPathAssignmentRepo(ctrl)
	repo.EXPECT().AdvanceStep(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.PathAssignment{
			ID:          uuid.New(),
			CurrentStep: 5,
			TotalSteps:  5,
			CompletedAt: &completed,
		}, true, domain.ErrAlreadyCompleted,
	)
	uc := &AdvancePathStep{Repo: repo}
	out, err := uc.Do(context.Background(), AdvancePathStepInput{
		RequesterID:  uuid.New(),
		AssignmentID: uuid.New(),
	})
	if err != nil {
		t.Fatalf("expected nil error on idempotent re-advance, got %v", err)
	}
	if !out.Completed {
		t.Fatalf("expected completed=true on idempotent re-advance")
	}
}

// ── helpers ────────────────────────────────────────────────────────────

func containsAll(s string, parts []string) bool {
	for _, p := range parts {
		if !contains(s, p) {
			return false
		}
	}
	return true
}

func contains(s, sub string) bool {
	if sub == "" {
		return true
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
