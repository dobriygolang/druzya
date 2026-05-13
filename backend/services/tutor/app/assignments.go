// Package app — tutor assignments use cases. Auth gates: tutor-side writes
// go through EnsureRelationship; student-side MarkComplete is gated by the
// SQL predicate (`student_id = $1`) so a malicious student can't probe
// foreign assignment ids.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// AssignmentTitleMax / AssignmentBodyMax — input caps. Title sized for
// «Read chapter 4 — The Black Swan» (~80 chars). Body sized for a long
// prompt with embedded markdown but well below the 1MB Postgres TEXT
// budget — past 8KB the tutor should be linking to a Reading-material
// instead of pasting it inline.
const (
	AssignmentTitleMax = 240
	AssignmentBodyMax  = 8_000
)

// PushAssignment — tutor creates a new assignment for one of their
// students. Validates input, calls EnsureRelationship, persists.
type PushAssignment struct {
	Repo domain.AssignmentRepo
	Now  func() time.Time
}

type PushAssignmentInput struct {
	TutorID   uuid.UUID
	StudentID uuid.UUID
	Title     string
	BodyMD    string
	DueAt     *time.Time // optional
}

func (uc *PushAssignment) Do(ctx context.Context, in PushAssignmentInput) (domain.Assignment, error) {
	if in.TutorID == uuid.Nil || in.StudentID == uuid.Nil {
		return domain.Assignment{}, fmt.Errorf("tutor.PushAssignment: %w", domain.ErrInvalidInput)
	}
	if in.TutorID == in.StudentID {
		return domain.Assignment{}, fmt.Errorf("tutor.PushAssignment: cannot self-assign")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return domain.Assignment{}, fmt.Errorf("tutor.PushAssignment: title required: %w", domain.ErrInvalidInput)
	}
	if len(title) > AssignmentTitleMax {
		return domain.Assignment{}, fmt.Errorf("tutor.PushAssignment: title too long (>%d): %w", AssignmentTitleMax, domain.ErrInvalidInput)
	}
	body := strings.TrimSpace(in.BodyMD)
	if len(body) > AssignmentBodyMax {
		return domain.Assignment{}, fmt.Errorf("tutor.PushAssignment: body too long (>%d): %w", AssignmentBodyMax, domain.ErrInvalidInput)
	}
	// Sanity-check on due date — explicitly past is rejected so the
	// tutor doesn't accidentally push something with a stale deadline
	// from copy-paste. «Today end-of-day» is fine; «yesterday» isn't.
	if in.DueAt != nil {
		now := nowOr(uc.Now)
		if in.DueAt.Before(now.Add(-1 * time.Hour)) {
			return domain.Assignment{}, fmt.Errorf("tutor.PushAssignment: due_at in the past: %w", domain.ErrInvalidInput)
		}
	}
	if err := uc.Repo.EnsureRelationship(ctx, in.TutorID, in.StudentID); err != nil {
		return domain.Assignment{}, fmt.Errorf("tutor.PushAssignment: %w", err)
	}
	saved, err := uc.Repo.CreateAssignment(ctx, domain.Assignment{
		TutorID:   in.TutorID,
		StudentID: in.StudentID,
		Title:     title,
		BodyMD:    body,
		DueAt:     in.DueAt,
	})
	if err != nil {
		return domain.Assignment{}, fmt.Errorf("tutor.PushAssignment: %w", err)
	}
	return saved, nil
}

// ListAssignmentsForTutor — tutor's view of one student's backlog.
// Includes completed AND archived (the dashboard renders status badges).
type ListAssignmentsForTutor struct {
	Repo domain.AssignmentRepo
}

type ListAssignmentsForTutorInput struct {
	TutorID   uuid.UUID
	StudentID uuid.UUID
	Limit     int
	Cursor    string
}

// ListAssignmentsForTutorOutput — items + opaque next cursor (empty = end).
type ListAssignmentsForTutorOutput struct {
	Items      []domain.Assignment
	NextCursor string
}

func (uc *ListAssignmentsForTutor) Do(ctx context.Context, in ListAssignmentsForTutorInput) (ListAssignmentsForTutorOutput, error) {
	if in.TutorID == uuid.Nil || in.StudentID == uuid.Nil {
		return ListAssignmentsForTutorOutput{}, fmt.Errorf("tutor.ListAssignmentsForTutor: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.EnsureRelationship(ctx, in.TutorID, in.StudentID); err != nil {
		return ListAssignmentsForTutorOutput{}, fmt.Errorf("tutor.ListAssignmentsForTutor: %w", err)
	}
	out, next, err := uc.Repo.ListByTutorStudentPaged(ctx, in.TutorID, in.StudentID, in.Limit, in.Cursor)
	if err != nil {
		return ListAssignmentsForTutorOutput{}, fmt.Errorf("tutor.ListAssignmentsForTutor: %w", err)
	}
	return ListAssignmentsForTutorOutput{Items: out, NextCursor: next}, nil
}

// ListPendingForStudent — student's «what to work on» feed. Used by
// the Hone Today surface to show tutor-pushed assignments.
type ListPendingForStudent struct {
	Repo domain.AssignmentRepo
}

// ListPendingForStudentOutput — items + opaque next cursor.
type ListPendingForStudentOutput struct {
	Items      []domain.Assignment
	NextCursor string
}

func (uc *ListPendingForStudent) Do(ctx context.Context, studentID uuid.UUID, limit int, cursor string) (ListPendingForStudentOutput, error) {
	if studentID == uuid.Nil {
		return ListPendingForStudentOutput{}, fmt.Errorf("tutor.ListPendingForStudent: %w", domain.ErrInvalidInput)
	}
	out, next, err := uc.Repo.ListPendingForStudentPaged(ctx, studentID, limit, cursor)
	if err != nil {
		return ListPendingForStudentOutput{}, fmt.Errorf("tutor.ListPendingForStudent: %w", err)
	}
	return ListPendingForStudentOutput{Items: out, NextCursor: next}, nil
}

// MarkAssignmentComplete — student stamps completed_at on their own
// assignment. The repo's SQL predicate gates by student_id; cross-user
// probe returns ErrNotFound, idempotent re-call returns
// ErrAlreadyCompleted (caller can either ignore or surface a toast).
type MarkAssignmentComplete struct {
	Repo domain.AssignmentRepo
	Now  func() time.Time
}

func (uc *MarkAssignmentComplete) Do(ctx context.Context, studentID, assignmentID uuid.UUID) error {
	if studentID == uuid.Nil || assignmentID == uuid.Nil {
		return fmt.Errorf("tutor.MarkAssignmentComplete: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.MarkComplete(ctx, studentID, assignmentID, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("tutor.MarkAssignmentComplete: %w", err)
	}
	return nil
}

// ArchiveAssignment — tutor withdraws a stale assignment.
type ArchiveAssignment struct {
	Repo domain.AssignmentRepo
	Now  func() time.Time
}

func (uc *ArchiveAssignment) Do(ctx context.Context, tutorID, assignmentID uuid.UUID) error {
	if tutorID == uuid.Nil || assignmentID == uuid.Nil {
		return fmt.Errorf("tutor.ArchiveAssignment: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.ArchiveAssignment(ctx, tutorID, assignmentID, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("tutor.ArchiveAssignment: %w", err)
	}
	return nil
}

// BroadcastAssignment — Wave 5.2a (slice of Tier 3 group classes).
// Tutor sends the same assignment body to ALL of their active students
// in one call. Returns the per-student outcomes so the UI can show «5
// pushed, 1 already had it» if some pre-existing dedup were ever wired
// (today every call creates a fresh row — assignments are intentionally
// non-deduplicated). No partial-failure rollback: if N-1 push, the
// failed student appears in `Failed` and the tutor can retry only that
// one. Better than aborting the whole batch when one user got deleted.
//
// Auth: this UC implicitly trusts that the tutor owns every student
// returned by Students.ListTutorStudents. Push then re-checks
// EnsureRelationship per student (defence in depth — if a relationship
// ended between the list and the push, that one fails cleanly).
type BroadcastAssignment struct {
	Students    domain.Repo           // for ListTutorStudents
	Assignments domain.AssignmentRepo // for CreateAssignment + EnsureRelationship
	Now         func() time.Time
}

type BroadcastAssignmentInput struct {
	TutorID uuid.UUID
	Title   string
	BodyMD  string
	DueAt   *time.Time // optional
}

// BroadcastResult — outcome of one broadcast pass. The UI renders
// «Pushed to N students» and lists failures separately.
type BroadcastResult struct {
	// Pushed lists the (student, assignment) pairs that succeeded.
	Pushed []domain.Assignment
	// Failed lists student ids that errored, paired with the error.
	// Kept as a typed list rather than a map so retry order is stable.
	Failed []BroadcastFailure
}

type BroadcastFailure struct {
	StudentID uuid.UUID
	Err       error
}

func (uc *BroadcastAssignment) Do(ctx context.Context, in BroadcastAssignmentInput) (BroadcastResult, error) {
	if in.TutorID == uuid.Nil {
		return BroadcastResult{}, fmt.Errorf("tutor.BroadcastAssignment: %w", domain.ErrInvalidInput)
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return BroadcastResult{}, fmt.Errorf("tutor.BroadcastAssignment: title required: %w", domain.ErrInvalidInput)
	}
	if len(title) > AssignmentTitleMax {
		return BroadcastResult{}, fmt.Errorf("tutor.BroadcastAssignment: title too long: %w", domain.ErrInvalidInput)
	}
	body := strings.TrimSpace(in.BodyMD)
	if len(body) > AssignmentBodyMax {
		return BroadcastResult{}, fmt.Errorf("tutor.BroadcastAssignment: body too long: %w", domain.ErrInvalidInput)
	}
	if in.DueAt != nil {
		now := nowOr(uc.Now)
		if in.DueAt.Before(now.Add(-1 * time.Hour)) {
			return BroadcastResult{}, fmt.Errorf("tutor.BroadcastAssignment: due_at in the past: %w", domain.ErrInvalidInput)
		}
	}

	rels, err := uc.Students.ListTutorStudents(ctx, in.TutorID)
	if err != nil {
		return BroadcastResult{}, fmt.Errorf("tutor.BroadcastAssignment: list students: %w", err)
	}
	if len(rels) == 0 {
		// No students — nothing to broadcast. Returning empty (vs error)
		// lets the UI render «У тебя пока нет активных студентов» without
		// having to special-case a sentinel error.
		return BroadcastResult{}, nil
	}

	out := BroadcastResult{
		Pushed: make([]domain.Assignment, 0, len(rels)),
	}
	for _, rel := range rels {
		if err := uc.Assignments.EnsureRelationship(ctx, in.TutorID, rel.StudentID); err != nil {
			out.Failed = append(out.Failed, BroadcastFailure{StudentID: rel.StudentID, Err: err})
			continue
		}
		saved, err := uc.Assignments.CreateAssignment(ctx, domain.Assignment{
			TutorID:   in.TutorID,
			StudentID: rel.StudentID,
			Title:     title,
			BodyMD:    body,
			DueAt:     in.DueAt,
		})
		if err != nil {
			out.Failed = append(out.Failed, BroadcastFailure{StudentID: rel.StudentID, Err: err})
			continue
		}
		out.Pushed = append(out.Pushed, saved)
	}
	return out, nil
}
