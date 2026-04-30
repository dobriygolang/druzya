// Package infra — pgx adapter for personal_events.
//
// Hand-rolled pgx (no sqlc). The query surface is small (~6 SQLs) and the
// schema is closed-set enums — sqlc would add more setup than upkeep.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/calendar/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.Repo over personal_events.
type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres wires the adapter.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	if pool == nil {
		panic("calendar/infra.NewPostgres: nil pool")
	}
	return &Postgres{pool: pool}
}

// Cast enums to text so scans land in plain string slots without
// depending on enum-OID registration on the connection (mirrors the
// pattern in mock_interview.Pipelines for the same reason).
const eventCols = `id, user_id, kind::text, title, description_md,
    starts_at, ends_at, all_day,
    company_id, role, current_level, readiness_pct,
    codex_article_slug, track_id, club_session_id,
    status::text, outcome_md, felt_score, finished_at,
    source, created_at, updated_at`

const eventColsWithCompany = `pe.id, pe.user_id, pe.kind::text, pe.title, pe.description_md,
    pe.starts_at, pe.ends_at, pe.all_day,
    pe.company_id, pe.role, pe.current_level, pe.readiness_pct,
    pe.codex_article_slug, pe.track_id, pe.club_session_id,
    pe.status::text, pe.outcome_md, pe.felt_score, pe.finished_at,
    pe.source, pe.created_at, pe.updated_at,
    COALESCE(c.name, '')`

// Create inserts an event row.
func (r *Postgres) Create(ctx context.Context, e domain.Event) (domain.Event, error) {
	if !e.Kind.IsValid() {
		return domain.Event{}, fmt.Errorf("calendar.Create: %w: invalid kind %q", domain.ErrInvalidInput, e.Kind)
	}
	if !e.Status.IsValid() {
		e.Status = domain.StatusPlanned
	}
	if !e.Source.IsValid() {
		e.Source = domain.SourceUser
	}
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	row := r.pool.QueryRow(ctx, `
        INSERT INTO personal_events (
            id, user_id, kind, title, description_md,
            starts_at, ends_at, all_day,
            company_id, role, current_level, readiness_pct,
            codex_article_slug, track_id, club_session_id,
            status, outcome_md, felt_score, finished_at, source
        ) VALUES (
            $1, $2, $3::personal_event_kind, $4, $5,
            $6, $7, $8,
            $9, $10, $11, $12,
            $13, $14, $15,
            $16::personal_event_status, $17, $18, $19, $20
        )
        RETURNING `+eventCols,
		sharedpg.UUID(e.ID), sharedpg.UUID(e.UserID), string(e.Kind),
		e.Title, e.Description,
		e.StartsAt, nullableTS(e.EndsAt), e.AllDay,
		nullableUUID(e.CompanyID), e.Role, e.CurrentLevel, int16(e.ReadinessPct),
		e.CodexArticleSlug, nullableUUID(e.TrackID), nullableUUID(e.ClubSessionID),
		string(e.Status), e.OutcomeMD, nullableInt(e.FeltScore), nullableTS(e.FinishedAt),
		string(e.Source),
	)
	out, err := scanEvent(row)
	if err != nil {
		return domain.Event{}, fmt.Errorf("calendar.Postgres.Create: %w", err)
	}
	return out, nil
}

// Get returns an event by id+owner. ErrNotFound when missing.
func (r *Postgres) Get(ctx context.Context, userID, eventID uuid.UUID) (domain.Event, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+eventCols+`
        FROM personal_events WHERE id = $1 AND user_id = $2`,
		sharedpg.UUID(eventID), sharedpg.UUID(userID))
	out, err := scanEvent(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Event{}, domain.ErrNotFound
		}
		return domain.Event{}, fmt.Errorf("calendar.Postgres.Get: %w", err)
	}
	return out, nil
}

// Update overwrites the editable fields of an event. Status / outcome are
// out-of-band (use SetStatus / UpsertOutcome) — keeping them out of this
// path means the planning-mutation flow can't accidentally walk the row
// into 'done' state.
func (r *Postgres) Update(ctx context.Context, e domain.Event) (domain.Event, error) {
	if !e.Kind.IsValid() {
		return domain.Event{}, fmt.Errorf("calendar.Update: %w: invalid kind %q", domain.ErrInvalidInput, e.Kind)
	}
	row := r.pool.QueryRow(ctx, `
        UPDATE personal_events SET
            kind               = $3::personal_event_kind,
            title              = $4,
            description_md     = $5,
            starts_at          = $6,
            ends_at            = $7,
            all_day            = $8,
            company_id         = $9,
            role               = $10,
            current_level      = $11,
            readiness_pct      = $12,
            codex_article_slug = $13,
            track_id           = $14,
            club_session_id    = $15,
            updated_at         = now()
        WHERE id = $1 AND user_id = $2
        RETURNING `+eventCols,
		sharedpg.UUID(e.ID), sharedpg.UUID(e.UserID), string(e.Kind),
		e.Title, e.Description,
		e.StartsAt, nullableTS(e.EndsAt), e.AllDay,
		nullableUUID(e.CompanyID), e.Role, e.CurrentLevel, int16(e.ReadinessPct),
		e.CodexArticleSlug, nullableUUID(e.TrackID), nullableUUID(e.ClubSessionID),
	)
	out, err := scanEvent(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Event{}, domain.ErrNotFound
		}
		return domain.Event{}, fmt.Errorf("calendar.Postgres.Update: %w", err)
	}
	return out, nil
}

// Delete removes an event by id+owner.
func (r *Postgres) Delete(ctx context.Context, userID, eventID uuid.UUID) error {
	cmd, err := r.pool.Exec(ctx,
		`DELETE FROM personal_events WHERE id = $1 AND user_id = $2`,
		sharedpg.UUID(eventID), sharedpg.UUID(userID))
	if err != nil {
		return fmt.Errorf("calendar.Postgres.Delete: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ListByUser returns events in [from, to), optionally filtered by kinds.
func (r *Postgres) ListByUser(ctx context.Context, userID uuid.UUID, from, to time.Time, kinds []domain.Kind) ([]domain.EventWithCompany, error) {
	q := `SELECT ` + eventColsWithCompany + `
        FROM personal_events pe
        LEFT JOIN companies c ON c.id = pe.company_id
        WHERE pe.user_id = $1
          AND pe.starts_at >= $2
          AND pe.starts_at < $3`
	args := []any{sharedpg.UUID(userID), from, to}
	if len(kinds) > 0 {
		strs := make([]string, len(kinds))
		for i, k := range kinds {
			strs[i] = string(k)
		}
		q += ` AND pe.kind = ANY($4::personal_event_kind[])`
		args = append(args, strs)
	}
	q += ` ORDER BY pe.starts_at ASC, pe.id ASC`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("calendar.Postgres.ListByUser: %w", err)
	}
	defer rows.Close()
	out := make([]domain.EventWithCompany, 0, 16)
	for rows.Next() {
		ev, err := scanEventWithCompany(rows)
		if err != nil {
			return nil, fmt.Errorf("calendar.Postgres.ListByUser: scan: %w", err)
		}
		out = append(out, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("calendar.Postgres.ListByUser: rows: %w", err)
	}
	return out, nil
}

// ListUpcomingForCoach returns planned events in [now, now+withinDays].
// Bounds withinDays to [1..365] so a misconfigured caller can't full-scan.
func (r *Postgres) ListUpcomingForCoach(ctx context.Context, userID uuid.UUID, withinDays int) ([]domain.EventWithCompany, error) {
	if withinDays <= 0 || withinDays > 365 {
		withinDays = 30
	}
	rows, err := r.pool.Query(ctx, `
        SELECT `+eventColsWithCompany+`
          FROM personal_events pe
          LEFT JOIN companies c ON c.id = pe.company_id
         WHERE pe.user_id = $1
           AND pe.status = 'planned'
           AND pe.starts_at >= now() - interval '6 hours'
           AND pe.starts_at <= now() + ($2 || ' days')::interval
         ORDER BY pe.starts_at ASC`,
		sharedpg.UUID(userID), fmt.Sprintf("%d", withinDays))
	if err != nil {
		return nil, fmt.Errorf("calendar.Postgres.ListUpcomingForCoach: %w", err)
	}
	defer rows.Close()
	out := make([]domain.EventWithCompany, 0, 8)
	for rows.Next() {
		ev, err := scanEventWithCompany(rows)
		if err != nil {
			return nil, fmt.Errorf("calendar.Postgres.ListUpcomingForCoach: scan: %w", err)
		}
		out = append(out, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("calendar.Postgres.ListUpcomingForCoach: rows: %w", err)
	}
	return out, nil
}

// SetStatus transitions an event. Stamps finished_at on terminal states.
func (r *Postgres) SetStatus(ctx context.Context, userID, eventID uuid.UUID, status domain.Status) (domain.Event, error) {
	if !status.IsValid() {
		return domain.Event{}, fmt.Errorf("calendar.SetStatus: %w: invalid status %q", domain.ErrInvalidInput, status)
	}
	row := r.pool.QueryRow(ctx, `
        UPDATE personal_events SET
            status      = $3::personal_event_status,
            finished_at = CASE
                WHEN $3 IN ('done','cancelled','no_show') THEN COALESCE(finished_at, now())
                ELSE finished_at
            END,
            updated_at  = now()
        WHERE id = $1 AND user_id = $2
        RETURNING `+eventCols,
		sharedpg.UUID(eventID), sharedpg.UUID(userID), string(status))
	out, err := scanEvent(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Event{}, domain.ErrNotFound
		}
		return domain.Event{}, fmt.Errorf("calendar.Postgres.SetStatus: %w", err)
	}
	return out, nil
}

// UpsertOutcome writes the post-event reflection. Auto-completes the
// status if still planned/live so the cron-side "still upcoming?"
// readers stop seeing the event.
func (r *Postgres) UpsertOutcome(ctx context.Context, userID, eventID uuid.UUID, feltScore *int, outcomeMD string) (domain.Event, error) {
	row := r.pool.QueryRow(ctx, `
        UPDATE personal_events SET
            outcome_md  = $3,
            felt_score  = $4,
            status      = CASE
                WHEN status IN ('planned','live') THEN 'done'::personal_event_status
                ELSE status
            END,
            finished_at = COALESCE(finished_at, now()),
            updated_at  = now()
        WHERE id = $1 AND user_id = $2
        RETURNING `+eventCols,
		sharedpg.UUID(eventID), sharedpg.UUID(userID), outcomeMD, nullableInt(feltScore))
	out, err := scanEvent(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Event{}, domain.ErrNotFound
		}
		return domain.Event{}, fmt.Errorf("calendar.Postgres.UpsertOutcome: %w", err)
	}
	return out, nil
}

// ── helpers ──────────────────────────────────────────────────────────────

func scanEvent(row pgx.Row) (domain.Event, error) {
	var (
		id, userID             pgtype.UUID
		kindStr                string
		title, descriptionMD   string
		startsAt               time.Time
		endsAt                 pgtype.Timestamptz
		allDay                 bool
		companyID              pgtype.UUID
		role, currentLevel     string
		readinessPct           int16
		codexSlug              string
		trackID, clubSessionID pgtype.UUID
		statusStr              string
		outcomeMD              string
		feltScore              pgtype.Int2
		finishedAt             pgtype.Timestamptz
		sourceStr              string
		createdAt, updatedAt   time.Time
	)
	if err := row.Scan(
		&id, &userID, &kindStr, &title, &descriptionMD,
		&startsAt, &endsAt, &allDay,
		&companyID, &role, &currentLevel, &readinessPct,
		&codexSlug, &trackID, &clubSessionID,
		&statusStr, &outcomeMD, &feltScore, &finishedAt,
		&sourceStr, &createdAt, &updatedAt,
	); err != nil {
		return domain.Event{}, fmt.Errorf("calendar.pg.scanEvent: %w", err)
	}
	e := domain.Event{
		ID:               sharedpg.UUIDFrom(id),
		UserID:           sharedpg.UUIDFrom(userID),
		Kind:             domain.Kind(kindStr),
		Title:            title,
		Description:      descriptionMD,
		StartsAt:         startsAt,
		AllDay:           allDay,
		Role:             role,
		CurrentLevel:     currentLevel,
		ReadinessPct:     int(readinessPct),
		CodexArticleSlug: codexSlug,
		Status:           domain.Status(statusStr),
		OutcomeMD:        outcomeMD,
		Source:           domain.Source(sourceStr),
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}
	if endsAt.Valid {
		t := endsAt.Time
		e.EndsAt = &t
	}
	if companyID.Valid {
		v := sharedpg.UUIDFrom(companyID)
		e.CompanyID = &v
	}
	if trackID.Valid {
		v := sharedpg.UUIDFrom(trackID)
		e.TrackID = &v
	}
	if clubSessionID.Valid {
		v := sharedpg.UUIDFrom(clubSessionID)
		e.ClubSessionID = &v
	}
	if feltScore.Valid {
		v := int(feltScore.Int16)
		e.FeltScore = &v
	}
	if finishedAt.Valid {
		t := finishedAt.Time
		e.FinishedAt = &t
	}
	return e, nil
}

func scanEventWithCompany(row pgx.Row) (domain.EventWithCompany, error) {
	var (
		id, userID             pgtype.UUID
		kindStr                string
		title, descriptionMD   string
		startsAt               time.Time
		endsAt                 pgtype.Timestamptz
		allDay                 bool
		companyID              pgtype.UUID
		role, currentLevel     string
		readinessPct           int16
		codexSlug              string
		trackID, clubSessionID pgtype.UUID
		statusStr              string
		outcomeMD              string
		feltScore              pgtype.Int2
		finishedAt             pgtype.Timestamptz
		sourceStr              string
		createdAt, updatedAt   time.Time
		companyName            string
	)
	if err := row.Scan(
		&id, &userID, &kindStr, &title, &descriptionMD,
		&startsAt, &endsAt, &allDay,
		&companyID, &role, &currentLevel, &readinessPct,
		&codexSlug, &trackID, &clubSessionID,
		&statusStr, &outcomeMD, &feltScore, &finishedAt,
		&sourceStr, &createdAt, &updatedAt,
		&companyName,
	); err != nil {
		return domain.EventWithCompany{}, fmt.Errorf("calendar.pg.scanEventWithCompany: %w", err)
	}
	e := domain.Event{
		ID:               sharedpg.UUIDFrom(id),
		UserID:           sharedpg.UUIDFrom(userID),
		Kind:             domain.Kind(kindStr),
		Title:            title,
		Description:      descriptionMD,
		StartsAt:         startsAt,
		AllDay:           allDay,
		Role:             role,
		CurrentLevel:     currentLevel,
		ReadinessPct:     int(readinessPct),
		CodexArticleSlug: codexSlug,
		Status:           domain.Status(statusStr),
		OutcomeMD:        outcomeMD,
		Source:           domain.Source(sourceStr),
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}
	if endsAt.Valid {
		t := endsAt.Time
		e.EndsAt = &t
	}
	if companyID.Valid {
		v := sharedpg.UUIDFrom(companyID)
		e.CompanyID = &v
	}
	if trackID.Valid {
		v := sharedpg.UUIDFrom(trackID)
		e.TrackID = &v
	}
	if clubSessionID.Valid {
		v := sharedpg.UUIDFrom(clubSessionID)
		e.ClubSessionID = &v
	}
	if feltScore.Valid {
		v := int(feltScore.Int16)
		e.FeltScore = &v
	}
	if finishedAt.Valid {
		t := finishedAt.Time
		e.FinishedAt = &t
	}
	return domain.EventWithCompany{Event: e, CompanyName: companyName}, nil
}

func nullableUUID(id *uuid.UUID) pgtype.UUID {
	if id == nil || *id == uuid.Nil {
		return pgtype.UUID{}
	}
	return sharedpg.UUID(*id)
}

func nullableTS(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

func nullableInt(v *int) pgtype.Int2 {
	if v == nil {
		return pgtype.Int2{}
	}
	return pgtype.Int2{Int16: int16(*v), Valid: true}
}

// Compile-time guard.
var _ domain.Repo = (*Postgres)(nil)
