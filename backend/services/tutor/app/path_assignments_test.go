// path_assignments_test.go — Phase K T2+T3 coverage.
package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// fakePathAssignmentRepo follows the same hand-rolled fake convention
// used by the rest of this package (fakeAssignmentRepo etc.).
type fakePathAssignmentRepo struct {
	create    func(ctx context.Context, a domain.PathAssignment) (domain.PathAssignment, error)
	get       func(ctx context.Context, r, a uuid.UUID) (domain.PathAssignment, error)
	listAct   func(ctx context.Context, s uuid.UUID) ([]domain.PathAssignment, error)
	advance   func(ctx context.Context, r, a uuid.UUID, now time.Time) (domain.PathAssignment, bool, error)
	bumpPath  func(ctx context.Context, p uuid.UUID) error
}

func (f fakePathAssignmentRepo) CreatePathAssignment(ctx context.Context, a domain.PathAssignment) (domain.PathAssignment, error) {
	if f.create == nil {
		return domain.PathAssignment{}, errors.New("create not set")
	}
	return f.create(ctx, a)
}
func (f fakePathAssignmentRepo) GetPathAssignment(ctx context.Context, r, a uuid.UUID) (domain.PathAssignment, error) {
	if f.get == nil {
		return domain.PathAssignment{}, errors.New("get not set")
	}
	return f.get(ctx, r, a)
}
func (f fakePathAssignmentRepo) ListActiveByStudent(ctx context.Context, s uuid.UUID) ([]domain.PathAssignment, error) {
	if f.listAct == nil {
		return nil, errors.New("listAct not set")
	}
	return f.listAct(ctx, s)
}
func (f fakePathAssignmentRepo) AdvanceStep(ctx context.Context, r, a uuid.UUID, now time.Time) (domain.PathAssignment, bool, error) {
	if f.advance == nil {
		return domain.PathAssignment{}, false, errors.New("advance not set")
	}
	return f.advance(ctx, r, a, now)
}
func (f fakePathAssignmentRepo) IncrementPathAssignedCount(ctx context.Context, p uuid.UUID) error {
	if f.bumpPath == nil {
		return nil // best-effort path; nil is fine
	}
	return f.bumpPath(ctx, p)
}

// ── AssignReadingPath ─────────────────────────────────────────────────

func TestAssignReadingPath_NilIDs(t *testing.T) {
	t.Parallel()
	uc := &AssignReadingPath{
		Paths:           fakeReadingPathRepo{},
		PathAssignments: fakePathAssignmentRepo{},
		Assignments:     fakeAssignmentRepo{},
	}
	_, err := uc.Do(context.Background(), AssignReadingPathInput{})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestAssignReadingPath_SelfAssign(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	uc := &AssignReadingPath{
		Paths:           fakeReadingPathRepo{},
		PathAssignments: fakePathAssignmentRepo{},
		Assignments:     fakeAssignmentRepo{},
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

	uc := &AssignReadingPath{
		Paths: fakeReadingPathRepo{
			get: func(_ context.Context, t, p uuid.UUID) (domain.ReadingPath, error) {
				if t != tutorID || p != pathID {
					return domain.ReadingPath{}, domain.ErrNotFound
				}
				return path, nil
			},
		},
		PathAssignments: fakePathAssignmentRepo{
			create: func(_ context.Context, a domain.PathAssignment) (domain.PathAssignment, error) {
				a.ID = pathAssignID
				savedPathAssignment = a
				return a, nil
			},
			bumpPath: func(_ context.Context, p uuid.UUID) error { return nil },
		},
		Assignments: fakeAssignmentRepo{
			ensure: func(_ context.Context, t, s uuid.UUID) error {
				if t != tutorID || s != studentID {
					return domain.ErrNotFound
				}
				return nil
			},
			create: func(_ context.Context, a domain.Assignment) (domain.Assignment, error) {
				a.ID = uuid.New()
				createdAssignments = append(createdAssignments, a)
				return a, nil
			},
		},
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
	tutorID := uuid.New()
	pathID := uuid.New()
	archived := time.Now()
	uc := &AssignReadingPath{
		Paths: fakeReadingPathRepo{
			get: func(_ context.Context, _, _ uuid.UUID) (domain.ReadingPath, error) {
				return domain.ReadingPath{
					ID:            pathID,
					TutorID:       tutorID,
					AtlasNodeKeys: []string{"x"},
					ArchivedAt:    &archived,
				}, nil
			},
		},
		PathAssignments: fakePathAssignmentRepo{},
		Assignments:     fakeAssignmentRepo{},
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
	tutorID := uuid.New()
	uc := &AssignReadingPath{
		Paths: fakeReadingPathRepo{
			get: func(_ context.Context, _, _ uuid.UUID) (domain.ReadingPath, error) {
				return domain.ReadingPath{ID: uuid.New(), TutorID: tutorID}, nil
			},
		},
		PathAssignments: fakePathAssignmentRepo{},
		Assignments:     fakeAssignmentRepo{},
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
	uc := &ListMyActivePathAssignments{Repo: fakePathAssignmentRepo{}}
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
	uc := &AdvancePathStep{Repo: fakePathAssignmentRepo{}}
	_, err := uc.Do(context.Background(), AdvancePathStepInput{})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestAdvancePathStep_AlreadyCompleted_NoError(t *testing.T) {
	t.Parallel()
	completed := time.Now()
	repo := fakePathAssignmentRepo{
		advance: func(_ context.Context, _, _ uuid.UUID, _ time.Time) (domain.PathAssignment, bool, error) {
			return domain.PathAssignment{
				ID:          uuid.New(),
				CurrentStep: 5,
				TotalSteps:  5,
				CompletedAt: &completed,
			}, true, domain.ErrAlreadyCompleted
		},
	}
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
