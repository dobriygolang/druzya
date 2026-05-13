package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/tutor/domain"
	"druz9/tutor/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ── PushAssignment ────────────────────────────────────────────────

func TestPushAssignment_HappyPath_GatesViaEnsure(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	studentID := uuid.New()

	repo := mocks.NewMockAssignmentRepo(ctrl)
	repo.EXPECT().EnsureRelationship(gomock.Any(), tutorID, studentID).Return(nil).Times(1)
	repo.EXPECT().CreateAssignment(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, a domain.Assignment) (domain.Assignment, error) {
			a.ID = uuid.New()
			a.CreatedAt = time.Now().UTC()
			return a, nil
		},
	)
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
	if out.Title != "Read chapter 4" {
		t.Errorf("title not trimmed: %q", out.Title)
	}
}

func TestPushAssignment_RejectsBadInput(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	// No EXPECT — ensure must not be called.
	uc := &PushAssignment{Repo: mocks.NewMockAssignmentRepo(ctrl)}
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
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockAssignmentRepo(ctrl)
	repo.EXPECT().EnsureRelationship(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.ErrNotFound)
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
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockAssignmentRepo(ctrl)
	repo.EXPECT().MarkComplete(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.ErrAlreadyCompleted)
	uc := &MarkAssignmentComplete{Repo: repo}
	err := uc.Do(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(err, domain.ErrAlreadyCompleted) {
		t.Errorf("expected ErrAlreadyCompleted, got %v", err)
	}
}

func TestMarkAssignmentComplete_RejectsZeroIDs(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &MarkAssignmentComplete{Repo: mocks.NewMockAssignmentRepo(ctrl)}
	if err := uc.Do(context.Background(), uuid.Nil, uuid.New()); err == nil {
		t.Error("expected error for zero student id")
	}
}

// ── BroadcastAssignment ───────────────────────────────────────────

func TestBroadcastAssignment_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	s1, s2 := uuid.New(), uuid.New()

	students := mocks.NewMockRepo(ctrl)
	students.EXPECT().ListTutorStudents(gomock.Any(), tutorID).Return([]domain.Relationship{
		{ID: uuid.New(), TutorID: tutorID, StudentID: s1},
		{ID: uuid.New(), TutorID: tutorID, StudentID: s2},
	}, nil)

	assignments := mocks.NewMockAssignmentRepo(ctrl)
	createCalls := 0
	assignments.EXPECT().EnsureRelationship(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	assignments.EXPECT().CreateAssignment(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, a domain.Assignment) (domain.Assignment, error) {
			createCalls++
			a.ID = uuid.New()
			return a, nil
		},
	).AnyTimes()

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
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	s1, s2 := uuid.New(), uuid.New()

	students := mocks.NewMockRepo(ctrl)
	students.EXPECT().ListTutorStudents(gomock.Any(), gomock.Any()).Return([]domain.Relationship{
		{StudentID: s1}, {StudentID: s2},
	}, nil)

	assignments := mocks.NewMockAssignmentRepo(ctrl)
	assignments.EXPECT().EnsureRelationship(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, sid uuid.UUID) error {
			if sid == s2 {
				return domain.ErrNotFound // relationship vanished mid-batch
			}
			return nil
		},
	).AnyTimes()
	assignments.EXPECT().CreateAssignment(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, a domain.Assignment) (domain.Assignment, error) {
			a.ID = uuid.New()
			return a, nil
		},
	).AnyTimes()

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
	ctrl := gomock.NewController(t)
	students := mocks.NewMockRepo(ctrl)
	students.EXPECT().ListTutorStudents(gomock.Any(), gomock.Any()).Return(nil, nil)
	// No assignments.EXPECT — ensure must not be called when no students.
	assignments := mocks.NewMockAssignmentRepo(ctrl)
	uc := &BroadcastAssignment{
		Students:    students,
		Assignments: assignments,
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
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockAssignmentRepo(ctrl)
	gomock.InOrder(
		repo.EXPECT().EnsureRelationship(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil),
		repo.EXPECT().ListByTutorStudentPaged(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return([]domain.Assignment{{Title: "ok"}}, "", nil),
	)
	uc := &ListAssignmentsForTutor{Repo: repo}
	out, err := uc.Do(context.Background(), ListAssignmentsForTutorInput{
		TutorID:   uuid.New(),
		StudentID: uuid.New(),
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out.Items) != 1 {
		t.Errorf("expected 1 item, got %d", len(out.Items))
	}
}
