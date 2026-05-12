// directory_repo.go — Phase K T1 (P0) 2026-05-12. PostgreSQL implementation
// of domain.DirectoryRepo. Same *Postgres struct adds another satisfied
// interface to its set (Repo + AssignmentRepo + EventRepo + ReadingPathRepo
// + DirectoryRepo) — Nth-interface pattern, single connection pool.
package infra

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// GetProfile — fetches by user_id PK. ErrNotFound on no row.
func (p *Postgres) GetProfile(ctx context.Context, userID uuid.UUID) (domain.DirectoryProfile, error) {
	const q = `
		SELECT user_id, visible, bio_md, expertise_tags, languages,
		       COALESCE(timezone, ''), COALESCE(availability_md, ''),
		       COALESCE(linkedin_url, ''), COALESCE(github_url, ''),
		       verified_at, COALESCE(application_message, ''),
		       created_at, updated_at
		FROM tutor_directory_profiles
		WHERE user_id = $1`
	var (
		uid           pgtype.UUID
		visible       bool
		bio           string
		tags          []string
		langs         []string
		tz            string
		avail         string
		linkedin      string
		github        string
		verifiedAt    pgtype.Timestamptz
		appMsg        string
		createdAt     pgtype.Timestamptz
		updatedAt     pgtype.Timestamptz
	)
	err := p.pool.QueryRow(ctx, q, pgUUID(userID)).Scan(
		&uid, &visible, &bio, &tags, &langs, &tz, &avail,
		&linkedin, &github, &verifiedAt, &appMsg, &createdAt, &updatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.DirectoryProfile{}, fmt.Errorf("tutor.GetProfile: %w", domain.ErrNotFound)
		}
		return domain.DirectoryProfile{}, fmt.Errorf("tutor.GetProfile: %w", err)
	}
	out := domain.DirectoryProfile{
		UserID:             uuidFrom(uid),
		Visible:            visible,
		BioMD:              bio,
		ExpertiseTags:      tags,
		Languages:          langs,
		Timezone:           tz,
		AvailabilityMD:     avail,
		LinkedinURL:        linkedin,
		GithubURL:          github,
		VerifiedAt:         nullableTime(verifiedAt),
		ApplicationMessage: appMsg,
	}
	if createdAt.Valid {
		out.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		out.UpdatedAt = updatedAt.Time
	}
	return out, nil
}

// UpsertProfile — INSERT … ON CONFLICT (user_id) DO UPDATE. Returns the
// canonical row post-write so caller sees server-stamped updated_at.
func (p *Postgres) UpsertProfile(
	ctx context.Context, profile domain.DirectoryProfile,
) (domain.DirectoryProfile, error) {
	if profile.ExpertiseTags == nil {
		profile.ExpertiseTags = []string{}
	}
	if profile.Languages == nil {
		profile.Languages = []string{}
	}
	const q = `
		INSERT INTO tutor_directory_profiles (
			user_id, visible, bio_md, expertise_tags, languages,
			timezone, availability_md, linkedin_url, github_url,
			application_message, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
		ON CONFLICT (user_id) DO UPDATE SET
			visible             = EXCLUDED.visible,
			bio_md              = EXCLUDED.bio_md,
			expertise_tags      = EXCLUDED.expertise_tags,
			languages           = EXCLUDED.languages,
			timezone            = EXCLUDED.timezone,
			availability_md     = EXCLUDED.availability_md,
			linkedin_url        = EXCLUDED.linkedin_url,
			github_url          = EXCLUDED.github_url,
			application_message = EXCLUDED.application_message,
			updated_at          = now()
		RETURNING user_id, visible, bio_md, expertise_tags, languages,
		          COALESCE(timezone, ''), COALESCE(availability_md, ''),
		          COALESCE(linkedin_url, ''), COALESCE(github_url, ''),
		          verified_at, COALESCE(application_message, ''),
		          created_at, updated_at`
	var (
		uid        pgtype.UUID
		visible    bool
		bio        string
		tags       []string
		langs      []string
		tz         string
		avail      string
		linkedin   string
		github     string
		verifiedAt pgtype.Timestamptz
		appMsg     string
		createdAt  pgtype.Timestamptz
		updatedAt  pgtype.Timestamptz
	)
	tzArg := nullableText(profile.Timezone)
	availArg := nullableText(profile.AvailabilityMD)
	linkedinArg := nullableText(profile.LinkedinURL)
	githubArg := nullableText(profile.GithubURL)
	appMsgArg := nullableText(profile.ApplicationMessage)
	err := p.pool.QueryRow(ctx, q,
		pgUUID(profile.UserID), profile.Visible, profile.BioMD,
		profile.ExpertiseTags, profile.Languages,
		tzArg, availArg, linkedinArg, githubArg, appMsgArg,
	).Scan(
		&uid, &visible, &bio, &tags, &langs, &tz, &avail,
		&linkedin, &github, &verifiedAt, &appMsg, &createdAt, &updatedAt,
	)
	if err != nil {
		return domain.DirectoryProfile{}, fmt.Errorf("tutor.UpsertProfile: %w", err)
	}
	out := domain.DirectoryProfile{
		UserID:             uuidFrom(uid),
		Visible:            visible,
		BioMD:              bio,
		ExpertiseTags:      tags,
		Languages:          langs,
		Timezone:           tz,
		AvailabilityMD:     avail,
		LinkedinURL:        linkedin,
		GithubURL:          github,
		VerifiedAt:         nullableTime(verifiedAt),
		ApplicationMessage: appMsg,
	}
	if createdAt.Valid {
		out.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		out.UpdatedAt = updatedAt.Time
	}
	return out, nil
}

// ListVisible — JOIN tutor_directory_profiles + users. Filters applied
// at SQL level so we don't ferry rows over the wire to drop them in Go.
// Keyset cursor: (created_at DESC, user_id DESC) — partial index
// idx_tutor_directory_visible serves the scan.
func (p *Postgres) ListVisible(
	ctx context.Context,
	filter domain.DirectoryFilter,
	limit int,
	cursor string,
) ([]domain.DirectoryEntry, string, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	args := []any{}
	conds := []string{"p.visible = true"}

	if len(filter.ExpertiseTags) > 0 {
		args = append(args, filter.ExpertiseTags)
		conds = append(conds, fmt.Sprintf("p.expertise_tags && $%d", len(args)))
	}
	if len(filter.Languages) > 0 {
		args = append(args, filter.Languages)
		conds = append(conds, fmt.Sprintf("p.languages && $%d", len(args)))
	}

	c, err := decodeCreatedAtCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListVisible: %w", err)
	}
	if !c.CreatedAt.IsZero() {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("tutor.ListVisible: cursor id: %w", parseErr)
		}
		args = append(args, c.CreatedAt, pgUUID(cid))
		conds = append(conds, fmt.Sprintf("(p.created_at, p.user_id) < ($%d, $%d)", len(args)-1, len(args)))
	}

	args = append(args, limit+1)
	q := fmt.Sprintf(`
		SELECT p.user_id,
		       COALESCE(u.display_name, ''),
		       COALESCE(u.username, ''),
		       COALESCE(u.avatar_url, ''),
		       p.bio_md, p.expertise_tags, p.languages,
		       COALESCE(p.timezone, ''),
		       p.verified_at IS NOT NULL
		FROM tutor_directory_profiles p
		JOIN users u ON u.id = p.user_id
		WHERE %s
		ORDER BY p.created_at DESC, p.user_id DESC
		LIMIT $%d`,
		strings.Join(conds, " AND "), len(args),
	)

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListVisible: %w", err)
	}
	defer rows.Close()

	out := make([]domain.DirectoryEntry, 0, limit)
	for rows.Next() {
		var (
			uid      pgtype.UUID
			display  string
			username string
			avatar   string
			bio      string
			tags     []string
			langs    []string
			tz       string
			verified bool
		)
		if err := rows.Scan(&uid, &display, &username, &avatar, &bio, &tags, &langs, &tz, &verified); err != nil {
			return nil, "", fmt.Errorf("tutor.ListVisible: scan: %w", err)
		}
		out = append(out, domain.DirectoryEntry{
			UserID:        uuidFrom(uid),
			DisplayName:   display,
			Username:      username,
			AvatarURL:     avatar,
			BioMD:         bio,
			ExpertiseTags: tags,
			Languages:     langs,
			Timezone:      tz,
			Verified:      verified,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("tutor.ListVisible: iterate: %w", err)
	}

	// For pagination we need the source created_at — but we only
	// SELECTed display fields. Run a tiny per-row addendum: since
	// next_cursor is needed for the last row only when len > limit, we
	// fetch it via the join above by also pulling p.created_at. The
	// simpler fix: pull p.created_at in the SELECT list. Re-issue
	// a denser query below.
	if len(out) > limit {
		out = out[:limit]
		// Re-fetch the last row's created_at to encode cursor. Cheap:
		// PK lookup на user_id.
		lastUID := out[len(out)-1].UserID
		var createdAt time.Time
		err := p.pool.QueryRow(ctx,
			`SELECT created_at FROM tutor_directory_profiles WHERE user_id = $1`,
			pgUUID(lastUID),
		).Scan(&createdAt)
		if err != nil {
			return nil, "", fmt.Errorf("tutor.ListVisible: cursor created_at: %w", err)
		}
		nextCursor := encodeCreatedAtCursor(createdAtCursor{
			CreatedAt: createdAt,
			ID:        lastUID.String(),
		})
		return out, nextCursor, nil
	}
	return out, "", nil
}

// CreateApplication — INSERT с unique partial index guard.
// On 23505 (already pending) → ErrAlreadyApplied. Self-apply blocked by
// CHECK at SQL layer (tutor_directory_applications_no_self) returns
// ErrInvalidInput.
func (p *Postgres) CreateApplication(
	ctx context.Context, app domain.Application,
) (domain.Application, error) {
	const q = `
		INSERT INTO tutor_directory_applications (tutor_id, student_id, message, status)
		VALUES ($1, $2, $3, 'pending')
		RETURNING id, created_at, updated_at`
	var (
		id        pgtype.UUID
		createdAt pgtype.Timestamptz
		updatedAt pgtype.Timestamptz
	)
	err := p.pool.QueryRow(ctx, q,
		pgUUID(app.TutorID), pgUUID(app.StudentID), app.Message,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			if pgErr.Code == "23505" {
				return domain.Application{}, fmt.Errorf("tutor.CreateApplication: %w", domain.ErrAlreadyApplied)
			}
			if pgErr.Code == "23514" { // check_violation
				return domain.Application{}, fmt.Errorf("tutor.CreateApplication: %w", domain.ErrInvalidInput)
			}
		}
		return domain.Application{}, fmt.Errorf("tutor.CreateApplication: %w", err)
	}
	app.ID = uuidFrom(id)
	app.Status = domain.ApplicationStatusPending
	if createdAt.Valid {
		app.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		app.UpdatedAt = updatedAt.Time
	}
	return app, nil
}

// ListApplicationsForTutor — pending only, newest first. Partial index
// idx_tutor_directory_applications_tutor_pending covers this query.
func (p *Postgres) ListApplicationsForTutor(
	ctx context.Context, tutorID uuid.UUID,
) ([]domain.ApplicationWithStudent, error) {
	const q = `
		SELECT a.id, a.tutor_id, a.student_id, a.message, a.status,
		       a.created_at, a.updated_at,
		       COALESCE(u.display_name, ''),
		       COALESCE(u.username, ''),
		       COALESCE(u.avatar_url, '')
		FROM tutor_directory_applications a
		JOIN users u ON u.id = a.student_id
		WHERE a.tutor_id = $1 AND a.status = 'pending'
		ORDER BY a.created_at DESC`
	rows, err := p.pool.Query(ctx, q, pgUUID(tutorID))
	if err != nil {
		return nil, fmt.Errorf("tutor.ListApplicationsForTutor: %w", err)
	}
	defer rows.Close()
	out := make([]domain.ApplicationWithStudent, 0, 8)
	for rows.Next() {
		var (
			id         pgtype.UUID
			tid        pgtype.UUID
			sid        pgtype.UUID
			msg        string
			status     string
			createdAt  pgtype.Timestamptz
			updatedAt  pgtype.Timestamptz
			display    string
			username   string
			avatar     string
		)
		if err := rows.Scan(&id, &tid, &sid, &msg, &status, &createdAt, &updatedAt, &display, &username, &avatar); err != nil {
			return nil, fmt.Errorf("tutor.ListApplicationsForTutor: scan: %w", err)
		}
		row := domain.ApplicationWithStudent{
			Application: domain.Application{
				ID:        uuidFrom(id),
				TutorID:   uuidFrom(tid),
				StudentID: uuidFrom(sid),
				Message:   msg,
				Status:    domain.ApplicationStatus(status),
			},
			StudentDisplayName: display,
			StudentUsername:    username,
			StudentAvatarURL:   avatar,
		}
		if createdAt.Valid {
			row.CreatedAt = createdAt.Time
		}
		if updatedAt.Valid {
			row.UpdatedAt = updatedAt.Time
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tutor.ListApplicationsForTutor: iterate: %w", err)
	}
	return out, nil
}

// AcceptApplication — two writes inside one tx (mirrors AcceptInvite):
//  1. UPDATE applications SET status='accepted' WHERE id=$1 AND tutor=$2 AND status='pending'
//  2. INSERT tutor_students (tutor, student) — на конфликт ErrAlreadyEnrolled.
func (p *Postgres) AcceptApplication(
	ctx context.Context,
	tutorID, applicationID uuid.UUID,
	now time.Time,
) (domain.Relationship, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptApplication: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Load + lock the application row.
	var (
		appID     pgtype.UUID
		tid       pgtype.UUID
		sid       pgtype.UUID
		status    string
	)
	row := tx.QueryRow(ctx, `
		SELECT id, tutor_id, student_id, status
		FROM tutor_directory_applications
		WHERE id = $1 AND tutor_id = $2
		FOR UPDATE`,
		pgUUID(applicationID), pgUUID(tutorID),
	)
	if err := row.Scan(&appID, &tid, &sid, &status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Relationship{}, fmt.Errorf("tutor.AcceptApplication: %w", domain.ErrNotFound)
		}
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptApplication: scan: %w", err)
	}
	if status != string(domain.ApplicationStatusPending) {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptApplication: %w (status %s)", domain.ErrInvalidInput, status)
	}

	studentID := uuidFrom(sid)
	tutorIDActual := uuidFrom(tid)

	// Insert the relationship; on conflict (already enrolled) it's a
	// no-op from the partial unique idx_tutor_students_active.
	var (
		relID     pgtype.UUID
		startedAt pgtype.Timestamptz
		endedAt   pgtype.Timestamptz
	)
	err = tx.QueryRow(ctx, `
		INSERT INTO tutor_students (tutor_id, student_id, invite_id)
		VALUES ($1, $2, NULL)
		RETURNING id, started_at, ended_at`,
		pgUUID(tutorIDActual), pgUUID(studentID),
	).Scan(&relID, &startedAt, &endedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.Relationship{}, fmt.Errorf("tutor.AcceptApplication: %w", domain.ErrAlreadyEnrolled)
		}
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptApplication: insert relationship: %w", err)
	}

	// Stamp application as accepted.
	if _, err := tx.Exec(ctx, `
		UPDATE tutor_directory_applications
		SET status = 'accepted', updated_at = $1
		WHERE id = $2`,
		pgtype.Timestamptz{Time: now, Valid: true}, pgUUID(applicationID),
	); err != nil {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptApplication: stamp: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptApplication: commit: %w", err)
	}

	rel := domain.Relationship{
		ID:        uuidFrom(relID),
		TutorID:   tutorIDActual,
		StudentID: studentID,
	}
	if startedAt.Valid {
		rel.StartedAt = startedAt.Time
	}
	rel.EndedAt = nullableTime(endedAt)
	return rel, nil
}

// DeclineApplication — soft-mark status='declined'. Idempotent for
// already-declined rows? No — strictly transitions from pending.
// Re-decline returns ErrInvalidInput.
func (p *Postgres) DeclineApplication(
	ctx context.Context,
	tutorID, applicationID uuid.UUID,
	now time.Time,
) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE tutor_directory_applications
		SET status = 'declined', updated_at = $1
		WHERE id = $2 AND tutor_id = $3 AND status = 'pending'`,
		pgtype.Timestamptz{Time: now, Valid: true},
		pgUUID(applicationID), pgUUID(tutorID),
	)
	if err != nil {
		return fmt.Errorf("tutor.DeclineApplication: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Either not found или already terminal. Probe to differentiate.
		var status string
		probeErr := p.pool.QueryRow(ctx,
			`SELECT status FROM tutor_directory_applications WHERE id = $1 AND tutor_id = $2`,
			pgUUID(applicationID), pgUUID(tutorID),
		).Scan(&status)
		if errors.Is(probeErr, pgx.ErrNoRows) {
			return fmt.Errorf("tutor.DeclineApplication: %w", domain.ErrNotFound)
		}
		if probeErr != nil {
			return fmt.Errorf("tutor.DeclineApplication: probe: %w", probeErr)
		}
		return fmt.Errorf("tutor.DeclineApplication: %w (status %s)", domain.ErrInvalidInput, status)
	}
	return nil
}

// nullableText — converts empty string to SQL NULL, non-empty to a
// driver-friendly pgtype.Text. Lets us roundtrip NULL/empty distinction
// consistently вместо INSERT'ить '' там где column allows NULL.
func nullableText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: s, Valid: true}
}
