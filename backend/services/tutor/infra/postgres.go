// Package infra provides the PostgreSQL-backed tutor.Repo. Hand-rolled
// pgx (no sqlc) because the surface is small (six methods, four are
// trivial CRUD) and dynamic SQL would dwarf the schema definition.
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
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool}
}

// pgUUID is a tiny adapter — the tutor module avoids importing
// druz9/shared/pkg/pg to keep its go.mod minimal. Same Bytes/Valid
// contract as sharedpg.UUID for consistency at call sites.
func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: id != uuid.Nil}
}

func uuidFrom(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func nullableUUID(p pgtype.UUID) *uuid.UUID {
	if !p.Valid {
		return nil
	}
	id := uuid.UUID(p.Bytes)
	return &id
}

func nullableTime(p pgtype.Timestamptz) *time.Time {
	if !p.Valid {
		return nil
	}
	t := p.Time
	return &t
}

// CreateInvite — INSERT. Caller has generated code + expires_at.
func (p *Postgres) CreateInvite(ctx context.Context, inv domain.Invite) (domain.Invite, error) {
	const q = `
		INSERT INTO tutor_invites (id, tutor_id, code, note, created_at, expires_at, target_user_id)
		VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, COALESCE($5, now()), $6, $7)
		RETURNING id, created_at`
	var (
		id        pgtype.UUID
		createdAt pgtype.Timestamptz
	)
	idArg := pgUUID(inv.ID) // Valid=false for uuid.Nil → server generates
	createdArg := pgtype.Timestamptz{Time: inv.CreatedAt, Valid: !inv.CreatedAt.IsZero()}
	var targetArg pgtype.UUID
	if inv.TargetUserID != nil {
		targetArg = pgUUID(*inv.TargetUserID)
	}
	err := p.pool.QueryRow(ctx, q,
		idArg, pgUUID(inv.TutorID), inv.Code, inv.Note,
		createdArg, pgtype.Timestamptz{Time: inv.ExpiresAt, Valid: true},
		targetArg,
	).Scan(&id, &createdAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
			return domain.Invite{}, fmt.Errorf("tutor.CreateInvite: %w (code collision)", domain.ErrInvalidInput)
		}
		return domain.Invite{}, fmt.Errorf("tutor.CreateInvite: %w", err)
	}
	inv.ID = uuidFrom(id)
	if createdAt.Valid {
		inv.CreatedAt = createdAt.Time
	}
	return inv, nil
}

// GetInviteByCode — by indexed unique code, regardless of state.
func (p *Postgres) GetInviteByCode(ctx context.Context, code string) (domain.Invite, error) {
	const q = `
		SELECT id, tutor_id, code, note, created_at, expires_at,
		       accepted_by, accepted_at, revoked_at, target_user_id
		FROM tutor_invites
		WHERE code = $1`
	row := p.pool.QueryRow(ctx, q, code)
	out, err := scanInvite(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Invite{}, fmt.Errorf("tutor.GetInviteByCode: %w", domain.ErrNotFound)
		}
		return domain.Invite{}, fmt.Errorf("tutor.GetInviteByCode: %w", err)
	}
	return out, nil
}

// ListTutorInvites — most-recent first. limit==0 means «no cap».
func (p *Postgres) ListTutorInvites(ctx context.Context, tutorID uuid.UUID, limit int) ([]domain.Invite, error) {
	q := `
		SELECT id, tutor_id, code, note, created_at, expires_at,
		       accepted_by, accepted_at, revoked_at, target_user_id
		FROM tutor_invites
		WHERE tutor_id = $1
		ORDER BY created_at DESC`
	args := []any{pgUUID(tutorID)}
	if limit > 0 {
		q += " LIMIT $2"
		args = append(args, limit)
	}
	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListTutorInvites: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Invite, 0, 16)
	for rows.Next() {
		inv, err := scanInvite(rows)
		if err != nil {
			return nil, fmt.Errorf("tutor.ListTutorInvites: scan: %w", err)
		}
		out = append(out, inv)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tutor.ListTutorInvites: iterate: %w", err)
	}
	return out, nil
}

// ListTutorInvitesPaged — keyset cursor variant.
// Sort: created_at DESC, id DESC. limit clamped 1..200, default 50.
func (p *Postgres) ListTutorInvitesPaged(
	ctx context.Context, tutorID uuid.UUID, limit int, cursor string,
) ([]domain.Invite, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	c, err := decodeCreatedAtCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListTutorInvites: %w", err)
	}
	args := []any{pgUUID(tutorID)}
	q := `
		SELECT id, tutor_id, code, note, created_at, expires_at,
		       accepted_by, accepted_at, revoked_at, target_user_id
		FROM tutor_invites
		WHERE tutor_id = $1`
	if !c.CreatedAt.IsZero() {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("tutor.ListTutorInvites: cursor id: %w", parseErr)
		}
		args = append(args, c.CreatedAt, pgUUID(cid))
		q += fmt.Sprintf(` AND (created_at, id) < ($%d, $%d)`, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	q += fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT $%d`, len(args))

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListTutorInvites: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Invite, 0, limit)
	for rows.Next() {
		inv, scanErr := scanInvite(rows)
		if scanErr != nil {
			return nil, "", fmt.Errorf("tutor.ListTutorInvites: scan: %w", scanErr)
		}
		out = append(out, inv)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("tutor.ListTutorInvites: iterate: %w", err)
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

// RevokeInvite stamps revoked_at on an active invite owned by tutorID.
// Returns the appropriate sentinel for terminal states so the handler
// can render the correct message instead of a generic 5xx.
func (p *Postgres) RevokeInvite(ctx context.Context, tutorID, inviteID uuid.UUID, now time.Time) error {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("tutor.RevokeInvite: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var inv domain.Invite
	row := tx.QueryRow(ctx, `
		SELECT id, tutor_id, code, note, created_at, expires_at,
		       accepted_by, accepted_at, revoked_at, target_user_id
		FROM tutor_invites
		WHERE id = $1 AND tutor_id = $2
		FOR UPDATE`, pgUUID(inviteID), pgUUID(tutorID))
	inv, scanErr := scanInvite(row)
	if scanErr != nil {
		if errors.Is(scanErr, pgx.ErrNoRows) {
			return fmt.Errorf("tutor.RevokeInvite: %w", domain.ErrNotFound)
		}
		return fmt.Errorf("tutor.RevokeInvite: scan: %w", scanErr)
	}
	if inv.AcceptedAt != nil {
		return fmt.Errorf("tutor.RevokeInvite: %w", domain.ErrInviteAccepted)
	}
	if inv.RevokedAt != nil {
		return fmt.Errorf("tutor.RevokeInvite: %w", domain.ErrInviteRevoked)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE tutor_invites SET revoked_at = $1 WHERE id = $2`,
		pgtype.Timestamptz{Time: now, Valid: true}, pgUUID(inviteID),
	); err != nil {
		return fmt.Errorf("tutor.RevokeInvite: update: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("tutor.RevokeInvite: commit: %w", err)
	}
	return nil
}

// AcceptInvite is the only multi-statement transaction in this file.
// Two stages inside one tx:
//  1. SELECT … FOR UPDATE on the invite → check state at `now`,
//     stamp accepted_at/accepted_by.
//  2. INSERT into tutor_students; ON CONFLICT (tutor, student)
//     WHERE ended_at IS NULL → DO NOTHING (means already enrolled
//     from a prior invite — return ErrAlreadyEnrolled).
//
// Self-invite check happens at app layer (caller has both ids); we
// also enforce it via tutor_students_self_link CHECK as defense.
func (p *Postgres) AcceptInvite(ctx context.Context, code string, studentID uuid.UUID, now time.Time) (domain.Relationship, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	row := tx.QueryRow(ctx, `
		SELECT id, tutor_id, code, note, created_at, expires_at,
		       accepted_by, accepted_at, revoked_at, target_user_id
		FROM tutor_invites
		WHERE code = $1
		FOR UPDATE`, code)
	inv, scanErr := scanInvite(row)
	if scanErr != nil {
		if errors.Is(scanErr, pgx.ErrNoRows) {
			return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: %w", domain.ErrNotFound)
		}
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: scan: %w", scanErr)
	}
	if inv.AcceptedAt != nil {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: %w", domain.ErrInviteAccepted)
	}
	if inv.RevokedAt != nil {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: %w", domain.ErrInviteRevoked)
	}
	if now.After(inv.ExpiresAt) {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: %w", domain.ErrInviteExpired)
	}
	if inv.TutorID == studentID {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: %w", domain.ErrSelfInvite)
	}

	// Try insert; if a row already exists (active relationship), the
	// partial unique idx_tutor_students_active fires.
	var (
		relID     pgtype.UUID
		startedAt pgtype.Timestamptz
		endedAt   pgtype.Timestamptz
	)
	err = tx.QueryRow(ctx, `
		INSERT INTO tutor_students (tutor_id, student_id, invite_id)
		VALUES ($1, $2, $3)
		RETURNING id, started_at, ended_at`,
		pgUUID(inv.TutorID), pgUUID(studentID), pgUUID(inv.ID),
	).Scan(&relID, &startedAt, &endedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: %w", domain.ErrAlreadyEnrolled)
		}
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: insert relationship: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE tutor_invites SET accepted_by = $1, accepted_at = $2 WHERE id = $3`,
		pgUUID(studentID), pgtype.Timestamptz{Time: now, Valid: true}, pgUUID(inv.ID),
	); err != nil {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: stamp: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: commit: %w", err)
	}

	rel := domain.Relationship{
		ID:        uuidFrom(relID),
		TutorID:   inv.TutorID,
		StudentID: studentID,
		InviteID:  &inv.ID,
		Note:      "",
	}
	if startedAt.Valid {
		rel.StartedAt = startedAt.Time
	}
	rel.EndedAt = nullableTime(endedAt)
	return rel, nil
}

// ListTutorStudents — active relationships only, most-recent first.
func (p *Postgres) ListTutorStudents(ctx context.Context, tutorID uuid.UUID) ([]domain.Relationship, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, tutor_id, student_id, invite_id, started_at, ended_at, note
		FROM tutor_students
		WHERE tutor_id = $1 AND ended_at IS NULL
		ORDER BY started_at DESC`,
		pgUUID(tutorID),
	)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListTutorStudents: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Relationship, 0, 16)
	for rows.Next() {
		var r domain.Relationship
		var idRaw, tutorIDRaw, studentIDRaw, inviteIDRaw pgtype.UUID
		var startedAt, endedAt pgtype.Timestamptz
		if err := rows.Scan(&idRaw, &tutorIDRaw, &studentIDRaw, &inviteIDRaw, &startedAt, &endedAt, &r.Note); err != nil {
			return nil, fmt.Errorf("tutor.ListTutorStudents: scan: %w", err)
		}
		r.ID = uuidFrom(idRaw)
		r.TutorID = uuidFrom(tutorIDRaw)
		r.StudentID = uuidFrom(studentIDRaw)
		r.InviteID = nullableUUID(inviteIDRaw)
		if startedAt.Valid {
			r.StartedAt = startedAt.Time
		}
		r.EndedAt = nullableTime(endedAt)
		out = append(out, r)
	}
	return out, nil
}

// ListStudentTutors — Wave 9.4 multi-tutor surface. Same shape as
// ListTutorStudents but filtered by student_id. Hits the existing
// idx_tutor_students_student_started index.
func (p *Postgres) ListStudentTutors(ctx context.Context, studentID uuid.UUID) ([]domain.Relationship, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, tutor_id, student_id, invite_id, started_at, ended_at, note
		FROM tutor_students
		WHERE student_id = $1 AND ended_at IS NULL
		ORDER BY started_at DESC`,
		pgUUID(studentID),
	)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListStudentTutors: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Relationship, 0, 4)
	for rows.Next() {
		var r domain.Relationship
		var idRaw, tutorIDRaw, studentIDRaw, inviteIDRaw pgtype.UUID
		var startedAt, endedAt pgtype.Timestamptz
		if err := rows.Scan(&idRaw, &tutorIDRaw, &studentIDRaw, &inviteIDRaw, &startedAt, &endedAt, &r.Note); err != nil {
			return nil, fmt.Errorf("tutor.ListStudentTutors: scan: %w", err)
		}
		r.ID = uuidFrom(idRaw)
		r.TutorID = uuidFrom(tutorIDRaw)
		r.StudentID = uuidFrom(studentIDRaw)
		r.InviteID = nullableUUID(inviteIDRaw)
		if startedAt.Valid {
			r.StartedAt = startedAt.Time
		}
		r.EndedAt = nullableTime(endedAt)
		out = append(out, r)
	}
	return out, nil
}

// EndRelationship soft-ends an active relationship.
func (p *Postgres) EndRelationship(ctx context.Context, tutorID, studentID uuid.UUID, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE tutor_students
		SET ended_at = $1
		WHERE tutor_id = $2 AND student_id = $3 AND ended_at IS NULL`,
		pgtype.Timestamptz{Time: now, Valid: true}, pgUUID(tutorID), pgUUID(studentID),
	)
	if err != nil {
		return fmt.Errorf("tutor.EndRelationship: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("tutor.EndRelationship: %w", domain.ErrNotFound)
	}
	return nil
}

// ── helpers ───────────────────────────────────────────────────────────

type rowScanner interface {
	Scan(dest ...any) error
}

func scanInvite(s rowScanner) (domain.Invite, error) {
	var (
		id           pgtype.UUID
		tutorID      pgtype.UUID
		acceptedBy   pgtype.UUID
		targetUserID pgtype.UUID
		createdAt    pgtype.Timestamptz
		expiresAt    pgtype.Timestamptz
		acceptedAt   pgtype.Timestamptz
		revokedAt    pgtype.Timestamptz
		code, note   string
	)
	if err := s.Scan(&id, &tutorID, &code, &note, &createdAt, &expiresAt, &acceptedBy, &acceptedAt, &revokedAt, &targetUserID); err != nil {
		return domain.Invite{}, fmt.Errorf("tutor.pg.scanInvite: %w", err)
	}
	out := domain.Invite{
		ID:           uuidFrom(id),
		TutorID:      uuidFrom(tutorID),
		Code:         code,
		Note:         note,
		AcceptedBy:   nullableUUID(acceptedBy),
		AcceptedAt:   nullableTime(acceptedAt),
		RevokedAt:    nullableTime(revokedAt),
		TargetUserID: nullableUUID(targetUserID),
	}
	if createdAt.Valid {
		out.CreatedAt = createdAt.Time
	}
	if expiresAt.Valid {
		out.ExpiresAt = expiresAt.Time
	}
	return out, nil
}

// FindUserByUsername implements domain.Repo.
func (p *Postgres) FindUserByUsername(ctx context.Context, username string) (uuid.UUID, error) {
	var id pgtype.UUID
	err := p.pool.QueryRow(ctx,
		`SELECT id FROM users WHERE username = $1 LIMIT 1`, username,
	).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, fmt.Errorf("tutor.FindUserByUsername: %w", domain.ErrNotFound)
		}
		return uuid.Nil, fmt.Errorf("tutor.FindUserByUsername: %w", err)
	}
	return uuidFrom(id), nil
}

// ListPendingInvitesForUser implements domain.Repo.
func (p *Postgres) ListPendingInvitesForUser(
	ctx context.Context, userID uuid.UUID, now time.Time,
) ([]domain.Invite, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, tutor_id, code, note, created_at, expires_at,
		       accepted_by, accepted_at, revoked_at, target_user_id
		FROM tutor_invites
		WHERE target_user_id = $1
		  AND accepted_at IS NULL
		  AND revoked_at IS NULL
		  AND expires_at > $2
		ORDER BY created_at DESC`,
		pgUUID(userID),
		pgtype.Timestamptz{Time: now.UTC(), Valid: true},
	)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListPendingInvitesForUser: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Invite, 0, 4)
	for rows.Next() {
		inv, scanErr := scanInvite(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, inv)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tutor.ListPendingInvitesForUser rows: %w", err)
	}
	return out, nil
}
