package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Assignment — Wave 5.1 of docs/feature/plan.md (Tutor Tier 2).
// A piece of work the tutor authors for a specific student: a chapter
// to read, a writing prompt, a mock to take. Lives in tutor_assignments
// (migration 00014). The student sees pending assignments on their
// Hone Today surface; the tutor sees them on the per-student dashboard
// page with completion status.
//
// Lifecycle:
//   - Created by tutor (CreatedAt stamped, CompletedAt + ArchivedAt nil)
//   - Student marks done → CompletedAt stamped
//   - OR tutor archives → ArchivedAt stamped (terminal; doesn't show
//     anywhere except the «Archived» drawer if we add one)
//
// The tutor and student see the SAME row but with different write
// permissions: tutor can archive + edit + delete; student can only
// flip CompletedAt. Both reads are gated by the SQL «WHERE tutor_id =
// $X / student_id = $X» predicate, no FK to tutor_students because
// relationships are mutable (end + restart).
type Assignment struct {
	ID          uuid.UUID
	TutorID     uuid.UUID
	StudentID   uuid.UUID
	Title       string
	BodyMD      string
	DueAt       *time.Time // nil = open-ended
	CreatedAt   time.Time
	CompletedAt *time.Time
	ArchivedAt  *time.Time
}

// IsActive returns true iff the assignment is neither completed nor
// archived. The student-side list query filters on this; the tutor-side
// list shows everything (with status badges).
func (a Assignment) IsActive() bool {
	return a.CompletedAt == nil && a.ArchivedAt == nil
}

// AssignmentRepo is the persistence surface. Separate from Repo / SnapshotRepo
// for the same reason — keeps test fakes minimal and lets the use case
// inject narrow surfaces.
type AssignmentRepo interface {
	// EnsureRelationship returns ErrNotFound if the (tutor, student)
	// pair has no active row in tutor_students. The use case calls
	// this before any tutor-side write so a malicious tutor can't
	// author assignments for a student they're not connected to.
	// Implementations share this with SnapshotRepo by composing the
	// same shared query — kept as a separate method here so the
	// AssignmentRepo can be implemented standalone in tests.
	EnsureRelationship(ctx context.Context, tutorID, studentID uuid.UUID) error

	// CreateAssignment persists a new assignment. Caller fills the
	// Tutor/Student/Title/Body/DueAt fields; the repo stamps ID +
	// CreatedAt and returns the saved row.
	CreateAssignment(ctx context.Context, a Assignment) (Assignment, error)

	// GetAssignment loads a single row. Cross-user leak protection:
	// repo MUST verify the requester is either the tutor or the
	// student on the row. ErrNotFound covers «doesn't exist» and
	// «exists but you can't see it».
	GetAssignment(ctx context.Context, requesterID, assignmentID uuid.UUID) (Assignment, error)

	// ListByTutorStudent — tutor's view of their assignments for
	// ONE student. Includes completed AND archived (status badges
	// rendered in UI). Most-recent first; limit caps the result.
	ListByTutorStudent(ctx context.Context, tutorID, studentID uuid.UUID, limit int) ([]Assignment, error)

	// ListPendingForStudent — student's view of «what do I need to
	// work on». Excludes completed AND archived. Ordered by due_at
	// (NULL last) then created_at desc — i.e. closest deadline first.
	ListPendingForStudent(ctx context.Context, studentID uuid.UUID, limit int) ([]Assignment, error)

	// MarkComplete stamps CompletedAt. Only the student on the row
	// can call this (verified by SQL gate). Idempotent — repeating
	// the call on an already-completed row is a no-op (returns
	// ErrAlreadyCompleted so the use case can decide whether to
	// surface it).
	MarkComplete(ctx context.Context, studentID, assignmentID uuid.UUID, now time.Time) error

	// ArchiveAssignment stamps ArchivedAt. Only the authoring tutor
	// can call this. Used when the tutor wants to withdraw a stale
	// assignment without deleting the audit row.
	ArchiveAssignment(ctx context.Context, tutorID, assignmentID uuid.UUID, now time.Time) error
}
