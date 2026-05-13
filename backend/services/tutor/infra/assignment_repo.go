// Package infra — hand-rolled pgx over tutor_assignments. Cross-user
// reads are gated в SQL: «requester is tutor OR student on the row».
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// CreateAssignment inserts a new row. Caller already validated the
// relationship via EnsureRelationship; the FK on users(id) catches a
// last-second user delete (rare race, returns wrapped pg error).
func (p *Postgres) CreateAssignment(ctx context.Context, a domain.Assignment) (domain.Assignment, error) {
	const q = `
		INSERT INTO tutor_assignments (tutor_id, student_id, title, body_md, due_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at`
	var id pgtype.UUID
	var createdAt pgtype.Timestamptz
	err := p.pool.QueryRow(ctx, q,
		pgUUID(a.TutorID), pgUUID(a.StudentID), a.Title, a.BodyMD,
		pgWriteTime(a.DueAt),
	).Scan(&id, &createdAt)
	if err != nil {
		return domain.Assignment{}, fmt.Errorf("tutor.CreateAssignment: %w", err)
	}
	a.ID = uuidFrom(id)
	if createdAt.Valid {
		a.CreatedAt = createdAt.Time
	}
	return a, nil
}

// GetAssignment reads a single row gated by «requester is tutor OR
// student». ErrNotFound covers both «doesn't exist» and «exists but
// you can't see it» — the same pattern as the rest of the codebase.
func (p *Postgres) GetAssignment(ctx context.Context, requesterID, assignmentID uuid.UUID) (domain.Assignment, error) {
	const q = `
		SELECT id, tutor_id, student_id, title, body_md, due_at, created_at, completed_at, archived_at
		FROM tutor_assignments
		WHERE id = $1 AND (tutor_id = $2 OR student_id = $2)`
	row := p.pool.QueryRow(ctx, q, pgUUID(assignmentID), pgUUID(requesterID))
	out, err := scanAssignment(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Assignment{}, fmt.Errorf("tutor.GetAssignment: %w", domain.ErrNotFound)
		}
		return domain.Assignment{}, fmt.Errorf("tutor.GetAssignment: %w", err)
	}
	return out, nil
}

// ListByTutorStudent — tutor's full backlog for one student. Includes
// completed AND archived; the dashboard renders status badges to
// distinguish. Index `idx_tutor_assignments_tutor_student_active`
// only covers active rows; for the full list we accept a non-partial
// scan over (tutor_id, student_id) — fine, list size stays small.
func (p *Postgres) ListByTutorStudent(ctx context.Context, tutorID, studentID uuid.UUID, limit int) ([]domain.Assignment, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT id, tutor_id, student_id, title, body_md, due_at, created_at, completed_at, archived_at
		FROM tutor_assignments
		WHERE tutor_id = $1 AND student_id = $2
		ORDER BY created_at DESC
		LIMIT $3`
	rows, err := p.pool.Query(ctx, q, pgUUID(tutorID), pgUUID(studentID), limit)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListByTutorStudent: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Assignment, 0, 16)
	for rows.Next() {
		a, err := scanAssignment(rows)
		if err != nil {
			return nil, fmt.Errorf("tutor.ListByTutorStudent: scan: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tutor.ListByTutorStudent: rows: %w", err)
	}
	return out, nil
}

// ListPendingForStudent — student-side «what to work on». Hits the
// partial index by repeating the predicate.
func (p *Postgres) ListPendingForStudent(ctx context.Context, studentID uuid.UUID, limit int) ([]domain.Assignment, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	const q = `
		SELECT id, tutor_id, student_id, title, body_md, due_at, created_at, completed_at, archived_at
		FROM tutor_assignments
		WHERE student_id = $1 AND archived_at IS NULL AND completed_at IS NULL
		ORDER BY due_at NULLS LAST, created_at DESC
		LIMIT $2`
	rows, err := p.pool.Query(ctx, q, pgUUID(studentID), limit)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListPendingForStudent: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Assignment, 0, 8)
	for rows.Next() {
		a, err := scanAssignment(rows)
		if err != nil {
			return nil, fmt.Errorf("tutor.ListPendingForStudent: scan: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tutor.ListPendingForStudent: rows: %w", err)
	}
	return out, nil
}

// ListByTutorStudentPaged — keyset-cursor variant of ListByTutorStudent.
// Sort: created_at DESC, id DESC. Empty cursor = first page.
func (p *Postgres) ListByTutorStudentPaged(
	ctx context.Context, tutorID, studentID uuid.UUID, limit int, cursor string,
) ([]domain.Assignment, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	c, err := decodeCreatedAtCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListByTutorStudent: %w", err)
	}
	args := []any{pgUUID(tutorID), pgUUID(studentID)}
	q := `
		SELECT id, tutor_id, student_id, title, body_md, due_at, created_at, completed_at, archived_at
		FROM tutor_assignments
		WHERE tutor_id = $1 AND student_id = $2`
	if !c.CreatedAt.IsZero() {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("tutor.ListByTutorStudent: cursor id: %w", parseErr)
		}
		args = append(args, c.CreatedAt, pgUUID(cid))
		q += fmt.Sprintf(` AND (created_at, id) < ($%d, $%d)`, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	q += fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT $%d`, len(args))

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListByTutorStudent: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Assignment, 0, limit)
	for rows.Next() {
		a, scanErr := scanAssignment(rows)
		if scanErr != nil {
			return nil, "", fmt.Errorf("tutor.ListByTutorStudent: scan: %w", scanErr)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("tutor.ListByTutorStudent: rows: %w", err)
	}
	var nextCursor string
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		nextCursor = encodeCreatedAtCursor(createdAtCursor{
			CreatedAt: last.CreatedAt,
			ID:        last.ID.String(),
		})
	}
	return out, nextCursor, nil
}

// ListPendingForStudentPaged — keyset cursor variant. Sort:
// created_at DESC, id DESC. The use-case ranking by due_at is
// kept on the non-paged path; pagination over a NULL-aware sort
// would require a more elaborate cursor envelope.
func (p *Postgres) ListPendingForStudentPaged(
	ctx context.Context, studentID uuid.UUID, limit int, cursor string,
) ([]domain.Assignment, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 25
	}
	c, err := decodeCreatedAtCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListPendingForStudent: %w", err)
	}
	args := []any{pgUUID(studentID)}
	q := `
		SELECT id, tutor_id, student_id, title, body_md, due_at, created_at, completed_at, archived_at
		FROM tutor_assignments
		WHERE student_id = $1 AND archived_at IS NULL AND completed_at IS NULL`
	if !c.CreatedAt.IsZero() {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("tutor.ListPendingForStudent: cursor id: %w", parseErr)
		}
		args = append(args, c.CreatedAt, pgUUID(cid))
		q += fmt.Sprintf(` AND (created_at, id) < ($%d, $%d)`, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	q += fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT $%d`, len(args))

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListPendingForStudent: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Assignment, 0, limit)
	for rows.Next() {
		a, scanErr := scanAssignment(rows)
		if scanErr != nil {
			return nil, "", fmt.Errorf("tutor.ListPendingForStudent: scan: %w", scanErr)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("tutor.ListPendingForStudent: rows: %w", err)
	}
	var nextCursor string
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		nextCursor = encodeCreatedAtCursor(createdAtCursor{
			CreatedAt: last.CreatedAt,
			ID:        last.ID.String(),
		})
	}
	return out, nextCursor, nil
}

// MarkComplete is student-only. The WHERE includes `completed_at IS
// NULL` so a re-call on an already-completed row is a 0-rows-affected
// no-op — we surface that as ErrAlreadyCompleted (vs ErrNotFound) so
// the use case can distinguish «already done — show the toast» from
// «doesn't exist — 404».
func (p *Postgres) MarkComplete(ctx context.Context, studentID, assignmentID uuid.UUID, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE tutor_assignments
		SET completed_at = $1
		WHERE id = $2 AND student_id = $3 AND archived_at IS NULL AND completed_at IS NULL`,
		pgtype.Timestamptz{Time: now, Valid: true}, pgUUID(assignmentID), pgUUID(studentID),
	)
	if err != nil {
		return fmt.Errorf("tutor.MarkComplete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Distinguish: was it just completed already, or actually missing?
		// One extra read; cheap and only on the rare contention path.
		var existsNow bool
		if err := p.pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM tutor_assignments
				WHERE id = $1 AND student_id = $2 AND archived_at IS NULL AND completed_at IS NOT NULL
			)`, pgUUID(assignmentID), pgUUID(studentID),
		).Scan(&existsNow); err != nil {
			return fmt.Errorf("tutor.MarkComplete: %w", domain.ErrNotFound)
		}
		if existsNow {
			return fmt.Errorf("tutor.MarkComplete: %w", domain.ErrAlreadyCompleted)
		}
		return fmt.Errorf("tutor.MarkComplete: %w", domain.ErrNotFound)
	}
	return nil
}

// ArchiveAssignment is tutor-only. Idempotent — re-archiving an
// already-archived row is a no-op (0 rows affected → ErrNotFound,
// which the caller treats as «nothing to do», not user-facing).
func (p *Postgres) ArchiveAssignment(ctx context.Context, tutorID, assignmentID uuid.UUID, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE tutor_assignments
		SET archived_at = $1
		WHERE id = $2 AND tutor_id = $3 AND archived_at IS NULL`,
		pgtype.Timestamptz{Time: now, Valid: true}, pgUUID(assignmentID), pgUUID(tutorID),
	)
	if err != nil {
		return fmt.Errorf("tutor.ArchiveAssignment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("tutor.ArchiveAssignment: %w", domain.ErrNotFound)
	}
	return nil
}

// ── helpers ────────────────────────────────────────────────────────
// rowScanner is shared with postgres.go (declared there).

func scanAssignment(r rowScanner) (domain.Assignment, error) {
	var (
		id, tutorID, studentID                    pgtype.UUID
		title, body                               string
		dueAt, createdAt, completedAt, archivedAt pgtype.Timestamptz
	)
	if err := r.Scan(&id, &tutorID, &studentID, &title, &body, &dueAt, &createdAt, &completedAt, &archivedAt); err != nil {
		return domain.Assignment{}, fmt.Errorf("tutor.scanAssignment: %w", err)
	}
	a := domain.Assignment{
		ID:        uuidFrom(id),
		TutorID:   uuidFrom(tutorID),
		StudentID: uuidFrom(studentID),
		Title:     title,
		BodyMD:    body,
	}
	a.DueAt = nullableTime(dueAt)
	if createdAt.Valid {
		a.CreatedAt = createdAt.Time
	}
	a.CompletedAt = nullableTime(completedAt)
	a.ArchivedAt = nullableTime(archivedAt)
	return a, nil
}

// pgWriteTime turns a *time.Time into a pgtype.Timestamptz for INSERT
// bindings. Mirrors the read-side `nullableTime` (which goes the
// other way) — kept distinct to avoid signature confusion.
func pgWriteTime(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

// DueWithinNeedsNotify implements domain.AssignmentRepo.
func (p *Postgres) DueWithinNeedsNotify(
	ctx context.Context,
	now time.Time,
	window time.Duration,
	limit int,
) ([]domain.Assignment, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	upper := now.Add(window)
	rows, err := p.pool.Query(ctx, `
		SELECT id, tutor_id, student_id, title, body_md, due_at, created_at, completed_at, archived_at
		FROM tutor_assignments
		WHERE due_at IS NOT NULL
		  AND due_at >  $1
		  AND due_at <= $2
		  AND due_notified_at IS NULL
		  AND completed_at IS NULL
		  AND archived_at IS NULL
		ORDER BY due_at
		LIMIT $3`,
		now.UTC(), upper.UTC(), limit,
	)
	if err != nil {
		return nil, fmt.Errorf("tutor.DueWithinNeedsNotify: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Assignment, 0, limit)
	for rows.Next() {
		a, scanErr := scanAssignment(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tutor.assignment_repo rows: %w", err)
	}
	return out, nil
}

// MarkDueNotified implements domain.AssignmentRepo.
func (p *Postgres) MarkDueNotified(ctx context.Context, assignmentID uuid.UUID, now time.Time) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE tutor_assignments
		SET due_notified_at = $2
		WHERE id = $1`,
		pgtype.UUID{Bytes: assignmentID, Valid: true},
		pgtype.Timestamptz{Time: now.UTC(), Valid: true},
	)
	if err != nil {
		return fmt.Errorf("tutor.MarkDueNotified: %w", err)
	}
	return nil
}
