// Package app — reading-path assignment use cases.
//
//   - AssignReadingPath  → tutor pushes a curated path to one student.
//     Server snapshots path contents, creates one tutor_path_assignments
//     row, AND emits per-step TutorAssignment entries so the student's
//     existing pending-feed picks the path up без new surfaces.
//
//   - ListMyActivePathAssignments → student-side «what paths am I on?».
//     Joins for path_name + tutor_display_name (denorm at read time so
//     the Hone «Active Paths» pane не делает N+1).
//
//   - AdvancePathStep → bumps current_step by 1 (server-side when a
//     step's TutorAssignment is completed, or directly by the student).
//     Idempotent on the boundary — re-call after completion returns
//     completed=true с тем же row.
//
// Auth gates:
//   - AssignReadingPath verifies (a) tutor owns the path and (b) the
//     tutor↔student relationship is active. Per-row auth at the SQL
//     gate inside GetReadingPathForTutor + EnsureRelationship.
//   - AdvancePathStep allows either the student OR the tutor on the
//     row to advance; foreign requester returns ErrNotFound.

package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// ── AssignReadingPath ──────────────────────────────────────────────────

type AssignReadingPath struct {
	// Paths — for fetching + snapshotting the source path.
	Paths domain.ReadingPathRepo
	// PathAssignments — for the new tutor_path_assignments row.
	PathAssignments domain.PathAssignmentRepo
	// Assignments — for per-step TutorAssignment rows (existing mechanism).
	Assignments domain.AssignmentRepo
	Now         func() time.Time
}

type AssignReadingPathInput struct {
	TutorID       uuid.UUID
	StudentID     uuid.UUID
	PathID        uuid.UUID
	// Optional. 0 = start at step 0. Bounded 0 <= StartingStep < total_steps.
	StartingStep int
}

type AssignReadingPathOutput struct {
	Assignment          domain.PathAssignment
	AssignmentsCreated  int
}

func (uc *AssignReadingPath) Do(ctx context.Context, in AssignReadingPathInput) (AssignReadingPathOutput, error) {
	if in.TutorID == uuid.Nil || in.StudentID == uuid.Nil || in.PathID == uuid.Nil {
		return AssignReadingPathOutput{}, fmt.Errorf("tutor.AssignReadingPath: %w", domain.ErrInvalidInput)
	}
	if in.TutorID == in.StudentID {
		return AssignReadingPathOutput{}, fmt.Errorf("tutor.AssignReadingPath: %w: cannot self-assign", domain.ErrInvalidInput)
	}
	if in.StartingStep < 0 {
		return AssignReadingPathOutput{}, fmt.Errorf("tutor.AssignReadingPath: %w: starting_step < 0", domain.ErrInvalidInput)
	}
	if uc.Paths == nil || uc.PathAssignments == nil || uc.Assignments == nil {
		return AssignReadingPathOutput{}, fmt.Errorf("tutor.AssignReadingPath: dependencies not wired")
	}

	// 1) Fetch source path (auth gate: tutor must own it).
	path, err := uc.Paths.GetReadingPathForTutor(ctx, in.TutorID, in.PathID)
	if err != nil {
		return AssignReadingPathOutput{}, fmt.Errorf("tutor.AssignReadingPath: %w", err)
	}
	if path.ArchivedAt != nil {
		// Can't assign an archived path — tutor must un-archive or clone.
		// Surfacing as InvalidInput rather than NotFound — the row exists,
		// the action is just disallowed at this state.
		return AssignReadingPathOutput{}, fmt.Errorf("tutor.AssignReadingPath: path archived: %w", domain.ErrInvalidInput)
	}
	totalSteps := len(path.AtlasNodeKeys)
	if totalSteps == 0 && len(path.ResourceIDs) == 0 {
		return AssignReadingPathOutput{}, fmt.Errorf("tutor.AssignReadingPath: empty path: %w", domain.ErrInvalidInput)
	}
	if in.StartingStep >= totalSteps && totalSteps > 0 {
		return AssignReadingPathOutput{}, fmt.Errorf("tutor.AssignReadingPath: %w: starting_step out of range", domain.ErrInvalidInput)
	}

	// 2) Auth gate: tutor↔student relationship must be active. EnsureRelationship
	//    is on AssignmentRepo (same impl backs both). Defence-in-depth: even if
	//    the tutor faked the student_id, the SQL gate catches it.
	if err := uc.Assignments.EnsureRelationship(ctx, in.TutorID, in.StudentID); err != nil {
		return AssignReadingPathOutput{}, fmt.Errorf("tutor.AssignReadingPath: %w", err)
	}

	now := nowOr(uc.Now)

	// 3) Create the tutor_path_assignments row. Snapshot is the source
	//    of truth from this point — edits to the path don't affect this
	//    assignment.
	row := domain.PathAssignment{
		PathID:                in.PathID,
		TutorID:               in.TutorID,
		StudentID:             in.StudentID,
		CurrentStep:           in.StartingStep,
		TotalSteps:            totalSteps,
		SnapshotAtlasNodeKeys: append([]string{}, path.AtlasNodeKeys...),
		SnapshotResourceIDs:   append([]uuid.UUID{}, path.ResourceIDs...),
		AssignedAt:            now,
	}
	saved, err := uc.PathAssignments.CreatePathAssignment(ctx, row)
	if err != nil {
		return AssignReadingPathOutput{}, fmt.Errorf("tutor.AssignReadingPath: %w", err)
	}

	// 4) Bump tutor_reading_paths.assigned_count для tutor-side UI.
	//    Best-effort: a failure here is non-fatal (the assignment row
	//    is the source of truth; the counter is a denorm convenience).
	_ = uc.PathAssignments.IncrementPathAssignedCount(ctx, in.PathID)

	// 5) Emit per-step TutorAssignment rows. Starts at the input
	//    StartingStep — earlier steps are skipped (tutor opted out).
	//    Failure on any one step is non-fatal: we return the count we
	//    successfully created. Better than aborting the whole batch
	//    when one INSERT races a constraint.
	created := 0
	for i := in.StartingStep; i < totalSteps; i++ {
		stepNumber := i + 1
		nodeKey := saved.SnapshotAtlasNodeKeys[i]
		title := fmt.Sprintf("%s — step %d/%d: %s", path.Name, stepNumber, totalSteps, nodeKey)
		body := buildPathStepBody(path.Name, stepNumber, totalSteps, nodeKey, "")
		if _, aErr := uc.Assignments.CreateAssignment(ctx, domain.Assignment{
			TutorID:   in.TutorID,
			StudentID: in.StudentID,
			Title:     truncate(title, AssignmentTitleMax),
			BodyMD:    truncate(body, AssignmentBodyMax),
		}); aErr != nil {
			// Soft failure — note in count and continue.
			continue
		}
		created++
	}
	// If the path is resource-only (no atlas keys), emit one assignment
	// per resource_id with a generic «open the resource» body. Resource
	// titles aren't in our schema (external_resources is in another
	// service); UI fetches the title at render time.
	if totalSteps == 0 {
		for i, rid := range saved.SnapshotResourceIDs {
			stepNumber := i + 1
			title := fmt.Sprintf("%s — resource %d/%d", path.Name, stepNumber, len(saved.SnapshotResourceIDs))
			body := buildPathStepBody(path.Name, stepNumber, len(saved.SnapshotResourceIDs), "", rid.String())
			if _, aErr := uc.Assignments.CreateAssignment(ctx, domain.Assignment{
				TutorID:   in.TutorID,
				StudentID: in.StudentID,
				Title:     truncate(title, AssignmentTitleMax),
				BodyMD:    truncate(body, AssignmentBodyMax),
			}); aErr != nil {
				continue
			}
			created++
		}
	}

	return AssignReadingPathOutput{
		Assignment:         saved,
		AssignmentsCreated: created,
	}, nil
}

// buildPathStepBody — markdown for one per-step assignment. Mentions
// the atlas node + linked resource (when present). Keeps the link out
// of the title so the title stays scannable.
func buildPathStepBody(pathName string, step, total int, nodeKey, resourceID string) string {
	out := fmt.Sprintf("Часть пути **%s** (шаг %d из %d).", pathName, step, total)
	if nodeKey != "" {
		out += fmt.Sprintf("\n\nAtlas node: `%s`", nodeKey)
	}
	if resourceID != "" {
		out += fmt.Sprintf("\n\nResource: `%s`", resourceID)
	}
	return out
}

// truncate keeps the first n bytes; used to honour the underlying
// assignment column caps without bubbling an error mid-batch.
func truncate(s string, n int) string {
	if n <= 0 || len(s) <= n {
		return s
	}
	return s[:n]
}

// ── ListMyActivePathAssignments ─────────────────────────────────────────

type ListMyActivePathAssignments struct {
	Repo domain.PathAssignmentRepo
}

func (uc *ListMyActivePathAssignments) Do(ctx context.Context, studentID uuid.UUID) ([]domain.PathAssignment, error) {
	if studentID == uuid.Nil {
		return nil, fmt.Errorf("tutor.ListMyActivePathAssignments: %w", domain.ErrInvalidInput)
	}
	if uc.Repo == nil {
		// Same defensive pattern as ListReadingPaths — degraded boot
		// returns empty list, not a crash.
		return nil, nil
	}
	out, err := uc.Repo.ListActiveByStudent(ctx, studentID)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListMyActivePathAssignments: %w", err)
	}
	return out, nil
}

// ── AdvancePathStep ─────────────────────────────────────────────────────

type AdvancePathStep struct {
	Repo domain.PathAssignmentRepo
	Now  func() time.Time
}

type AdvancePathStepInput struct {
	RequesterID  uuid.UUID
	AssignmentID uuid.UUID
}

type AdvancePathStepOutput struct {
	Assignment domain.PathAssignment
	Completed  bool
}

func (uc *AdvancePathStep) Do(ctx context.Context, in AdvancePathStepInput) (AdvancePathStepOutput, error) {
	if in.RequesterID == uuid.Nil || in.AssignmentID == uuid.Nil {
		return AdvancePathStepOutput{}, fmt.Errorf("tutor.AdvancePathStep: %w", domain.ErrInvalidInput)
	}
	if uc.Repo == nil {
		return AdvancePathStepOutput{}, fmt.Errorf("tutor.AdvancePathStep: repo not wired")
	}
	row, done, err := uc.Repo.AdvanceStep(ctx, in.RequesterID, in.AssignmentID, nowOr(uc.Now))
	if err != nil {
		// ErrAlreadyCompleted is benign — the caller still gets the row
		// and the completed flag so the UI can react. Propagate other
		// errors verbatim.
		if errors.Is(err, domain.ErrAlreadyCompleted) {
			return AdvancePathStepOutput{Assignment: row, Completed: true}, nil
		}
		return AdvancePathStepOutput{}, fmt.Errorf("tutor.AdvancePathStep: %w", err)
	}
	return AdvancePathStepOutput{Assignment: row, Completed: done}, nil
}
