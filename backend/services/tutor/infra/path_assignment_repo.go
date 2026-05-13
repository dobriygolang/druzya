// Package infra — pgx-backed domain.PathAssignmentRepo.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// CreatePathAssignment inserts a row. Collision on the partial unique
// index idx_tpa_unique_active means the student already has this path
// active — surfaced as ErrAlreadyEnrolled so the caller can either
// no-op or show a toast.
func (p *Postgres) CreatePathAssignment(ctx context.Context, a domain.PathAssignment) (domain.PathAssignment, error) {
	const q = `
		INSERT INTO tutor_path_assignments (
			path_id, tutor_id, student_id,
			current_step, total_steps,
			snapshot_atlas_node_keys, snapshot_resource_ids
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, assigned_at`
	var (
		id         pgtype.UUID
		assignedAt pgtype.Timestamptz
	)
	err := p.pool.QueryRow(ctx, q,
		pgUUID(a.PathID), pgUUID(a.TutorID), pgUUID(a.StudentID),
		a.CurrentStep, a.TotalSteps,
		a.SnapshotAtlasNodeKeys, uuidArrToPg(a.SnapshotResourceIDs),
	).Scan(&id, &assignedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.PathAssignment{}, fmt.Errorf("tutor.CreatePathAssignment: %w", domain.ErrAlreadyEnrolled)
		}
		return domain.PathAssignment{}, fmt.Errorf("tutor.CreatePathAssignment: %w", err)
	}
	a.ID = uuidFrom(id)
	if assignedAt.Valid {
		a.AssignedAt = assignedAt.Time
	}
	return a, nil
}

// GetPathAssignment fetches one row gated by «requester is tutor OR
// student» — same convention as GetAssignment. Joins for display fields
// so the single-row view can render «step N/M · path: X · tutor: Y».
func (p *Postgres) GetPathAssignment(
	ctx context.Context, requesterID, assignmentID uuid.UUID,
) (domain.PathAssignment, error) {
	const q = `
		SELECT pa.id, pa.path_id, pa.tutor_id, pa.student_id,
		       pa.current_step, pa.total_steps,
		       pa.snapshot_atlas_node_keys, pa.snapshot_resource_ids,
		       pa.assigned_at, pa.completed_at, pa.archived_at,
		       COALESCE(rp.name, ''),
		       COALESCE(NULLIF(u.display_name, ''), u.username, '')
		FROM tutor_path_assignments pa
		LEFT JOIN tutor_reading_paths rp ON rp.id = pa.path_id
		LEFT JOIN users u                ON u.id  = pa.tutor_id
		WHERE pa.id = $1 AND (pa.tutor_id = $2 OR pa.student_id = $2)`
	row := p.pool.QueryRow(ctx, q, pgUUID(assignmentID), pgUUID(requesterID))
	out, err := scanPathAssignmentWithDisplay(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.PathAssignment{}, fmt.Errorf("tutor.GetPathAssignment: %w", domain.ErrNotFound)
		}
		return domain.PathAssignment{}, fmt.Errorf("tutor.GetPathAssignment: %w", err)
	}
	return out, nil
}

// ListActiveByStudent — student-side hot read. Hits idx_tpa_student_active.
// Joins:
//   - tutor_reading_paths.name (for «Active Paths · Senior Go · 3/9»)
//   - users.display_name / username (for «tutor: Maria»)
//
// Sort: assigned_at DESC so the most recently assigned path bubbles up.
func (p *Postgres) ListActiveByStudent(
	ctx context.Context, studentID uuid.UUID,
) ([]domain.PathAssignment, error) {
	const q = `
		SELECT pa.id, pa.path_id, pa.tutor_id, pa.student_id,
		       pa.current_step, pa.total_steps,
		       pa.snapshot_atlas_node_keys, pa.snapshot_resource_ids,
		       pa.assigned_at, pa.completed_at, pa.archived_at,
		       COALESCE(rp.name, ''),
		       COALESCE(NULLIF(u.display_name, ''), u.username, '')
		FROM tutor_path_assignments pa
		LEFT JOIN tutor_reading_paths rp ON rp.id = pa.path_id
		LEFT JOIN users u                ON u.id  = pa.tutor_id
		WHERE pa.student_id = $1 AND pa.completed_at IS NULL AND pa.archived_at IS NULL
		ORDER BY pa.assigned_at DESC
		LIMIT 50`
	rows, err := p.pool.Query(ctx, q, pgUUID(studentID))
	if err != nil {
		return nil, fmt.Errorf("tutor.ListActiveByStudent: %w", err)
	}
	defer rows.Close()
	out := make([]domain.PathAssignment, 0, 4)
	for rows.Next() {
		row, scanErr := scanPathAssignmentWithDisplay(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("tutor.ListActiveByStudent scan: %w", scanErr)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tutor.ListActiveByStudent rows: %w", err)
	}
	return out, nil
}

// AdvanceStep bumps current_step. If the bump brings current_step ==
// total_steps, completed_at is stamped in the same UPDATE so a slow
// reader can never see «step N/N but not completed». Boundary semantics:
//
//   - row not found / not yours → ErrNotFound
//   - already completed         → ErrAlreadyCompleted (with the row loaded)
//   - normal advance            → returns the updated row + done=true iff
//                                  this advance crossed the finish line.
func (p *Postgres) AdvanceStep(
	ctx context.Context, requesterID, assignmentID uuid.UUID, now time.Time,
) (domain.PathAssignment, bool, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.PathAssignment{}, false, fmt.Errorf("tutor.AdvanceStep begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// SELECT FOR UPDATE inside the tx so two concurrent advances don't
	// double-stamp completed_at or skip a step.
	var (
		id, pathID, tutorID, studentID pgtype.UUID
		currentStep, totalSteps        int32
		snapshotKeys                   []string
		snapshotRes                    []pgtype.UUID
		assignedAt                     pgtype.Timestamptz
		completedAt                    pgtype.Timestamptz
		archivedAt                     pgtype.Timestamptz
	)
	row := tx.QueryRow(ctx, `
		SELECT id, path_id, tutor_id, student_id,
		       current_step, total_steps,
		       snapshot_atlas_node_keys, snapshot_resource_ids,
		       assigned_at, completed_at, archived_at
		FROM tutor_path_assignments
		WHERE id = $1 AND (tutor_id = $2 OR student_id = $2)
		FOR UPDATE`,
		pgUUID(assignmentID), pgUUID(requesterID),
	)
	if err := row.Scan(&id, &pathID, &tutorID, &studentID,
		&currentStep, &totalSteps,
		&snapshotKeys, &snapshotRes,
		&assignedAt, &completedAt, &archivedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.PathAssignment{}, false, fmt.Errorf("tutor.AdvanceStep: %w", domain.ErrNotFound)
		}
		return domain.PathAssignment{}, false, fmt.Errorf("tutor.AdvanceStep scan: %w", err)
	}

	loadedRow := domain.PathAssignment{
		ID:                    uuidFrom(id),
		PathID:                uuidFrom(pathID),
		TutorID:               uuidFrom(tutorID),
		StudentID:             uuidFrom(studentID),
		CurrentStep:           int(currentStep),
		TotalSteps:            int(totalSteps),
		SnapshotAtlasNodeKeys: snapshotKeys,
		SnapshotResourceIDs:   pgArrToUUIDs(snapshotRes),
	}
	if assignedAt.Valid {
		loadedRow.AssignedAt = assignedAt.Time
	}
	loadedRow.CompletedAt = nullableTime(completedAt)
	loadedRow.ArchivedAt = nullableTime(archivedAt)

	if archivedAt.Valid {
		return loadedRow, false, fmt.Errorf("tutor.AdvanceStep: %w", domain.ErrNotFound)
	}
	if completedAt.Valid {
		return loadedRow, true, fmt.Errorf("tutor.AdvanceStep: %w", domain.ErrAlreadyCompleted)
	}

	newStep := currentStep + 1
	if newStep > totalSteps {
		newStep = totalSteps
	}
	completedNow := newStep >= totalSteps
	var completedTS pgtype.Timestamptz
	if completedNow {
		completedTS = pgtype.Timestamptz{Time: now, Valid: true}
	}

	var (
		updatedStep   int32
		updatedCompAt pgtype.Timestamptz
	)
	if err := tx.QueryRow(ctx, `
		UPDATE tutor_path_assignments
		SET current_step = $1,
		    completed_at = COALESCE($2, completed_at)
		WHERE id = $3
		RETURNING current_step, completed_at`,
		newStep, completedTS, pgUUID(loadedRow.ID),
	).Scan(&updatedStep, &updatedCompAt); err != nil {
		return domain.PathAssignment{}, false, fmt.Errorf("tutor.AdvanceStep update: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.PathAssignment{}, false, fmt.Errorf("tutor.AdvanceStep commit: %w", err)
	}
	loadedRow.CurrentStep = int(updatedStep)
	loadedRow.CompletedAt = nullableTime(updatedCompAt)
	return loadedRow, completedNow, nil
}

// IncrementPathAssignedCount bumps the denorm counter on the source path.
// Non-transactional (best-effort) — the counter is a display convenience,
// not the source of truth. A periodic reconciliation job could resync it
// from COUNT(*) over tutor_path_assignments if it ever drifts.
func (p *Postgres) IncrementPathAssignedCount(ctx context.Context, pathID uuid.UUID) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE tutor_reading_paths
		SET assigned_count = assigned_count + 1, updated_at = now()
		WHERE id = $1`,
		pgUUID(pathID),
	)
	if err != nil {
		return fmt.Errorf("tutor.IncrementPathAssignedCount: %w", err)
	}
	return nil
}

// scanPathAssignmentWithDisplay scans the standard column list PLUS the
// joined display columns (path_name, tutor_display_name). Used by all
// query paths in this file.
func scanPathAssignmentWithDisplay(s rowScanner) (domain.PathAssignment, error) {
	var (
		id, pathID, tutorID, studentID pgtype.UUID
		currentStep, totalSteps        int32
		snapshotKeys                   []string
		snapshotRes                    []pgtype.UUID
		assignedAt                     pgtype.Timestamptz
		completedAt                    pgtype.Timestamptz
		archivedAt                     pgtype.Timestamptz
		pathName                       string
		tutorDisplayName               string
	)
	if err := s.Scan(
		&id, &pathID, &tutorID, &studentID,
		&currentStep, &totalSteps,
		&snapshotKeys, &snapshotRes,
		&assignedAt, &completedAt, &archivedAt,
		&pathName, &tutorDisplayName,
	); err != nil {
		return domain.PathAssignment{}, err
	}
	out := domain.PathAssignment{
		ID:                    uuidFrom(id),
		PathID:                uuidFrom(pathID),
		TutorID:               uuidFrom(tutorID),
		StudentID:             uuidFrom(studentID),
		CurrentStep:           int(currentStep),
		TotalSteps:            int(totalSteps),
		SnapshotAtlasNodeKeys: snapshotKeys,
		SnapshotResourceIDs:   pgArrToUUIDs(snapshotRes),
		PathName:              pathName,
		TutorDisplayName:      tutorDisplayName,
	}
	if assignedAt.Valid {
		out.AssignedAt = assignedAt.Time
	}
	out.CompletedAt = nullableTime(completedAt)
	out.ArchivedAt = nullableTime(archivedAt)
	return out, nil
}
