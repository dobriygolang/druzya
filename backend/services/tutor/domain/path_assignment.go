// path_assignment.go — Phase K T2+T3 (2026-05-12). Tracks the
// many-to-many relationship «path X assigned to student Y» so the
// student-side UI can render «Active Paths · step N / M» and the
// tutor can re-assign after archive without unique-constraint pain.
//
// The snapshot fields freeze the path's contents at assign time —
// edits to the source tutor_reading_paths row don't mutate in-flight
// assignments. This matches the invoice / order-pinning pattern: the
// curated content the tutor handed off is the contract.

package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// PathAssignment — one row in tutor_path_assignments.
type PathAssignment struct {
	ID                     uuid.UUID
	PathID                 uuid.UUID
	TutorID                uuid.UUID
	StudentID              uuid.UUID
	CurrentStep            int
	TotalSteps             int
	SnapshotAtlasNodeKeys  []string
	SnapshotResourceIDs    []uuid.UUID
	AssignedAt             time.Time
	CompletedAt            *time.Time
	ArchivedAt             *time.Time
	// Display fields — server-filled on List queries (joined from
	// tutor_reading_paths + users). Empty on raw repo reads.
	PathName          string
	TutorDisplayName  string
}

// IsActive — assignment is currently in flight.
func (a PathAssignment) IsActive() bool {
	return a.CompletedAt == nil && a.ArchivedAt == nil
}

// PathAssignmentRepo — pgx-backed persistence for tutor_path_assignments.
type PathAssignmentRepo interface {
	// CreatePathAssignment inserts a row + the snapshot arrays. The
	// underlying unique index protects against double-assign of the
	// same active path; collision is surfaced as ErrAlreadyEnrolled
	// so the caller can either ignore or show a toast.
	CreatePathAssignment(ctx context.Context, a PathAssignment) (PathAssignment, error)

	// GetPathAssignment loads a single row gated by «requester is tutor
	// OR student». ErrNotFound covers «doesn't exist» / «not yours».
	GetPathAssignment(ctx context.Context, requesterID, assignmentID uuid.UUID) (PathAssignment, error)

	// ListActiveByStudent — student-side hot read. Joins:
	//   - tutor_reading_paths for path_name
	//   - users for tutor_display_name
	// Hits idx_tpa_student_active.
	ListActiveByStudent(ctx context.Context, studentID uuid.UUID) ([]PathAssignment, error)

	// AdvanceStep bumps current_step by 1 (or stamps completed_at when
	// the bump reaches total_steps). Idempotent on the boundary —
	// re-call after completion returns the same row + ErrAlreadyCompleted.
	// Auth gate: only the assignment's student OR tutor can advance.
	AdvanceStep(ctx context.Context, requesterID, assignmentID uuid.UUID, now time.Time) (PathAssignment, bool /*completed*/, error)

	// IncrementPathAssignedCount bumps tutor_reading_paths.assigned_count
	// after a successful insert. Called as a separate statement (vs
	// trigger) so the use case can compose it under its own tx.
	IncrementPathAssignedCount(ctx context.Context, pathID uuid.UUID) error
}
