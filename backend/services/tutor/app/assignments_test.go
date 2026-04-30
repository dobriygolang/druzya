package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// fakeAssignmentRepo — hand-rolled fake matching domain.AssignmentRepo.
// Same convention as fakeSnapshotRepo: nil closure = «not expected to
// be called»; we surface that as an explicit error rather than a nil
// panic so the failing test points at the wrong field.
type fakeAssignmentRepo struct {
	ensure       func(ctx context.Context, tutorID, studentID uuid.UUID) error
	create       func(ctx context.Context, a domain.Assignment) (domain.Assignment, error)
	get          func(ctx context.Context, requesterID, assignmentID uuid.UUID) (domain.Assignment, error)
	listByPair   func(ctx context.Context, tutorID, studentID uuid.UUID, limit int) ([]domain.Assignment, error)
	listPending  func(ctx context.Context, studentID uuid.UUID, limit int) ([]domain.Assignment, error)
	markComplete func(ctx context.Context, studentID, assignmentID uuid.UUID, now time.Time) error
	archive      func(ctx context.Context, tutorID, assignmentID uuid.UUID, now time.Time) error
}

func (f fakeAssignmentRepo) EnsureRelationship(ctx context.Context, t, s uuid.UUID) error {
	if f.ensure == nil {
		return errors.New("ensure not set")
	}
	return f.ensure(ctx, t, s)
}
func (f fakeAssignmentRepo) CreateAssignment(ctx context.Context, a domain.Assignment) (domain.Assignment, error) {
	if f.create == nil {
		return domain.Assignment{}, errors.New("create not set")
	}
	return f.create(ctx, a)
}
func (f fakeAssignmentRepo) GetAssignment(ctx context.Context, r, a uuid.UUID) (domain.Assignment, error) {
	if f.get == nil {
		return domain.Assignment{}, errors.New("get not set")
	}
	return f.get(ctx, r, a)
}
func (f fakeAssignmentRepo) ListByTutorStudent(ctx context.Context, t, s uuid.UUID, l int) ([]domain.Assignment, error) {
	if f.listByPair == nil {
		return nil, errors.New("listByPair not set")
	}
	return f.listByPair(ctx, t, s, l)
}
func (f fakeAssignmentRepo) ListPendingForStudent(ctx context.Context, s uuid.UUID, l int) ([]domain.Assignment, error) {
	if f.listPending == nil {
		return nil, errors.New("listPending not set")
	}
	return f.listPending(ctx, s, l)
}
func (f fakeAssignmentRepo) MarkComplete(ctx context.Context, s, a uuid.UUID, now time.Time) error {
	if f.markComplete == nil {
		return errors.New("markComplete not set")
	}
	return f.markComplete(ctx, s, a, now)
}
func (f fakeAssignmentRepo) ArchiveAssignment(ctx context.Context, t, a uuid.UUID, now time.Time) error {
	if f.archive == nil {
		return errors.New("archive not set")
	}
	return f.archive(ctx, t, a, now)
}

// ── PushAssignment ────────────────────────────────────────────────

func TestPushAssignment_HappyPath_GatesViaEnsure(t *testing.T) {
	t.Parallel()
	tutorID := uuid.New()
	studentID := uuid.New()

	ensureCalls := 0
	repo := fakeAssignmentRepo{
		ensure: func(_ context.Context, t, s uuid.UUID) error {
			ensureCalls++
			if t != tutorID || s != studentID {
				return errors.New("wrong ids in ensure")
			}
			return nil
		},
		create: func(_ context.Context, a domain.Assignment) (domain.Assignment, error) {
			a.ID = uuid.New()
			a.CreatedAt = time.Now().UTC()
			return a, nil
		},
	}
	uc := &PushAssignment{Repo: repo}
	out, err := uc.Do(context.Background(), PushAssignmentInput{
		TutorID:   tutorID,
		StudentID: studentID,
		Title:     "  Read chapter 4  ",
		BodyMD:    "Pages 80-120, focus on the Black Swan section.",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if ensureCalls != 1 {
		t.Errorf("ensure expected 1 call, got %d", ensureCalls)
	}
	if out.Title != "Read chapter 4" {
		t.Errorf("title not trimmed: %q", out.Title)
	}
}

func TestPushAssignment_RejectsBadInput(t *testing.T) {
	t.Parallel()
	repo := fakeAssignmentRepo{
		ensure: func(_ context.Context, _, _ uuid.UUID) error {
			t.Fatal("ensure must not be called for bad input")
			return nil
		},
	}
	uc := &PushAssignment{Repo: repo}
	cases := []struct {
		name string
		in   PushAssignmentInput
	}{
		{"zero ids", PushAssignmentInput{Title: "x"}},
		{"self-assign", func() PushAssignmentInput {
			id := uuid.New()
			return PushAssignmentInput{TutorID: id, StudentID: id, Title: "x"}
		}()},
		{"empty title", PushAssignmentInput{TutorID: uuid.New(), StudentID: uuid.New(), Title: "  "}},
		{"oversize title", PushAssignmentInput{
			TutorID:   uuid.New(),
			StudentID: uuid.New(),
			Title:     strings.Repeat("a", AssignmentTitleMax+1),
		}},
		{"oversize body", PushAssignmentInput{
			TutorID:   uuid.New(),
			StudentID: uuid.New(),
			Title:     "x",
			BodyMD:    strings.Repeat("a", AssignmentBodyMax+1),
		}},
		{"due in past", func() PushAssignmentInput {
			past := time.Now().UTC().Add(-48 * time.Hour)
			return PushAssignmentInput{
				TutorID:   uuid.New(),
				StudentID: uuid.New(),
				Title:     "x",
				DueAt:     &past,
			}
		}()},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if _, err := uc.Do(context.Background(), c.in); err == nil {
				t.Errorf("expected error for %s", c.name)
			}
		})
	}
}

func TestPushAssignment_RelationshipMissingPropagates(t *testing.T) {
	t.Parallel()
	repo := fakeAssignmentRepo{
		ensure: func(_ context.Context, _, _ uuid.UUID) error { return domain.ErrNotFound },
	}
	uc := &PushAssignment{Repo: repo}
	_, err := uc.Do(context.Background(), PushAssignmentInput{
		TutorID:   uuid.New(),
		StudentID: uuid.New(),
		Title:     "x",
	})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

// ── MarkAssignmentComplete ─────────────────────────────────────────

func TestMarkAssignmentComplete_AlreadyCompletedPropagates(t *testing.T) {
	t.Parallel()
	repo := fakeAssignmentRepo{
		markComplete: func(_ context.Context, _, _ uuid.UUID, _ time.Time) error {
			return domain.ErrAlreadyCompleted
		},
	}
	uc := &MarkAssignmentComplete{Repo: repo}
	err := uc.Do(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(err, domain.ErrAlreadyCompleted) {
		t.Errorf("expected ErrAlreadyCompleted, got %v", err)
	}
}

func TestMarkAssignmentComplete_RejectsZeroIDs(t *testing.T) {
	t.Parallel()
	uc := &MarkAssignmentComplete{Repo: fakeAssignmentRepo{}}
	if err := uc.Do(context.Background(), uuid.Nil, uuid.New()); err == nil {
		t.Error("expected error for zero student id")
	}
}

// ── BroadcastAssignment ───────────────────────────────────────────

// fakeStudentsRepo — minimal stand-in for domain.Repo, only the
// ListTutorStudents method exercised by BroadcastAssignment.
type fakeStudentsRepo struct {
	listStudents func(ctx context.Context, tutorID uuid.UUID) ([]domain.Relationship, error)
}

func (f fakeStudentsRepo) CreateInvite(_ context.Context, _ domain.Invite) (domain.Invite, error) {
	return domain.Invite{}, errors.New("not implemented")
}
func (f fakeStudentsRepo) GetInviteByCode(_ context.Context, _ string) (domain.Invite, error) {
	return domain.Invite{}, errors.New("not implemented")
}
func (f fakeStudentsRepo) ListTutorInvites(_ context.Context, _ uuid.UUID, _ int) ([]domain.Invite, error) {
	return nil, errors.New("not implemented")
}
func (f fakeStudentsRepo) RevokeInvite(_ context.Context, _, _ uuid.UUID, _ time.Time) error {
	return errors.New("not implemented")
}
func (f fakeStudentsRepo) AcceptInvite(_ context.Context, _ string, _ uuid.UUID, _ time.Time) (domain.Relationship, error) {
	return domain.Relationship{}, errors.New("not implemented")
}
func (f fakeStudentsRepo) ListTutorStudents(ctx context.Context, t uuid.UUID) ([]domain.Relationship, error) {
	if f.listStudents == nil {
		return nil, errors.New("listStudents not set")
	}
	return f.listStudents(ctx, t)
}
func (f fakeStudentsRepo) ListStudentTutors(_ context.Context, _ uuid.UUID) ([]domain.Relationship, error) {
	return nil, errors.New("not implemented")
}
func (f fakeStudentsRepo) EndRelationship(_ context.Context, _, _ uuid.UUID, _ time.Time) error {
	return errors.New("not implemented")
}

func TestBroadcastAssignment_HappyPath(t *testing.T) {
	t.Parallel()
	tutorID := uuid.New()
	s1, s2 := uuid.New(), uuid.New()

	students := fakeStudentsRepo{
		listStudents: func(_ context.Context, tid uuid.UUID) ([]domain.Relationship, error) {
			if tid != tutorID {
				t.Errorf("wrong tutor id: %v", tid)
			}
			return []domain.Relationship{
				{ID: uuid.New(), TutorID: tid, StudentID: s1},
				{ID: uuid.New(), TutorID: tid, StudentID: s2},
			}, nil
		},
	}
	createCalls := 0
	assignments := fakeAssignmentRepo{
		ensure: func(_ context.Context, _, _ uuid.UUID) error { return nil },
		create: func(_ context.Context, a domain.Assignment) (domain.Assignment, error) {
			createCalls++
			a.ID = uuid.New()
			return a, nil
		},
	}
	uc := &BroadcastAssignment{Students: students, Assignments: assignments}

	out, err := uc.Do(context.Background(), BroadcastAssignmentInput{
		TutorID: tutorID,
		Title:   "Read chapter 4",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out.Pushed) != 2 || createCalls != 2 {
		t.Errorf("expected 2 pushes; pushed=%d createCalls=%d", len(out.Pushed), createCalls)
	}
	if len(out.Failed) != 0 {
		t.Errorf("no failures expected, got %d", len(out.Failed))
	}
}

func TestBroadcastAssignment_PartialFailure(t *testing.T) {
	t.Parallel()
	tutorID := uuid.New()
	s1, s2 := uuid.New(), uuid.New()

	students := fakeStudentsRepo{
		listStudents: func(_ context.Context, _ uuid.UUID) ([]domain.Relationship, error) {
			return []domain.Relationship{
				{StudentID: s1}, {StudentID: s2},
			}, nil
		},
	}
	assignments := fakeAssignmentRepo{
		ensure: func(_ context.Context, _, sid uuid.UUID) error {
			if sid == s2 {
				return domain.ErrNotFound // relationship vanished mid-batch
			}
			return nil
		},
		create: func(_ context.Context, a domain.Assignment) (domain.Assignment, error) {
			a.ID = uuid.New()
			return a, nil
		},
	}
	uc := &BroadcastAssignment{Students: students, Assignments: assignments}
	out, err := uc.Do(context.Background(), BroadcastAssignmentInput{
		TutorID: tutorID,
		Title:   "Read chapter 4",
	})
	if err != nil {
		t.Fatalf("must not abort whole batch: %v", err)
	}
	if len(out.Pushed) != 1 || len(out.Failed) != 1 {
		t.Errorf("expected 1 push + 1 fail; got pushed=%d failed=%d", len(out.Pushed), len(out.Failed))
	}
	if out.Failed[0].StudentID != s2 {
		t.Errorf("wrong failure target: %v", out.Failed[0].StudentID)
	}
}

func TestBroadcastAssignment_NoStudentsYieldsEmpty(t *testing.T) {
	t.Parallel()
	students := fakeStudentsRepo{
		listStudents: func(_ context.Context, _ uuid.UUID) ([]domain.Relationship, error) {
			return nil, nil
		},
	}
	uc := &BroadcastAssignment{
		Students: students,
		Assignments: fakeAssignmentRepo{
			ensure: func(_ context.Context, _, _ uuid.UUID) error {
				t.Fatal("ensure must not be called when no students")
				return nil
			},
		},
	}
	out, err := uc.Do(context.Background(), BroadcastAssignmentInput{
		TutorID: uuid.New(),
		Title:   "x",
	})
	if err != nil {
		t.Fatalf("empty broadcast should not error: %v", err)
	}
	if len(out.Pushed) != 0 || len(out.Failed) != 0 {
		t.Errorf("expected empty result; got pushed=%d failed=%d", len(out.Pushed), len(out.Failed))
	}
}

// ── ListAssignmentsForTutor ────────────────────────────────────────

func TestListAssignmentsForTutor_GatesViaEnsureFirst(t *testing.T) {
	t.Parallel()
	calls := []string{}
	repo := fakeAssignmentRepo{
		ensure: func(_ context.Context, _, _ uuid.UUID) error {
			calls = append(calls, "ensure")
			return nil
		},
		listByPair: func(_ context.Context, _, _ uuid.UUID, _ int) ([]domain.Assignment, error) {
			calls = append(calls, "list")
			return []domain.Assignment{{Title: "ok"}}, nil
		},
	}
	uc := &ListAssignmentsForTutor{Repo: repo}
	out, err := uc.Do(context.Background(), ListAssignmentsForTutorInput{
		TutorID:   uuid.New(),
		StudentID: uuid.New(),
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 1 {
		t.Errorf("expected 1 item, got %d", len(out))
	}
	if len(calls) != 2 || calls[0] != "ensure" || calls[1] != "list" {
		t.Errorf("ensure must be called BEFORE list; got %v", calls)
	}
}
