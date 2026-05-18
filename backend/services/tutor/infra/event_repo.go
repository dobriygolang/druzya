// Package infra — hand-rolled pgx over tutor_events. Methods on the
// existing *Postgres so the monolith wiring keeps a single dependency.
//
// Auth: every read filters by requester=tutor OR requester=student;
// writes are tutor-only and gated by tutor_id match. The XOR between
// student_id and circle_id is enforced by the SQL CHECK so we don't
// duplicate the rule at the application layer.
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

// CreateEvent inserts a new row. Caller already validated via
// EnsureRelationship + Event.Validate; the FK / CHECK constraints
// catch last-second races (user deletion, capacity-without-circle).
func (p *Postgres) CreateEvent(ctx context.Context, e domain.Event) (domain.Event, error) {
	const q = `
		INSERT INTO tutor_events
			(tutor_id, student_id, circle_id, title, body_md,
			 scheduled_at, duration_min, meet_url, capacity)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, status, created_at, updated_at`
	var (
		id         pgtype.UUID
		status     string
		created    pgtype.Timestamptz
		updated    pgtype.Timestamptz
		studentArg = nullablePgUUID(e.StudentID)
		circleArg  = nullablePgUUID(e.CircleID)
		capArg     pgtype.Int4
	)
	if e.Capacity != nil {
		capArg = pgtype.Int4{Int32: int32(*e.Capacity), Valid: true}
	}
	if err := p.pool.QueryRow(ctx, q,
		pgUUID(e.TutorID), studentArg, circleArg,
		e.Title, e.BodyMD,
		pgtype.Timestamptz{Time: e.ScheduledAt.UTC(), Valid: true},
		e.DurationMin, e.MeetURL, capArg,
	).Scan(&id, &status, &created, &updated); err != nil {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: %w", err)
	}
	e.ID = uuidFrom(id)
	e.Status = domain.EventStatus(status)
	if created.Valid {
		e.CreatedAt = created.Time
	}
	if updated.Valid {
		e.UpdatedAt = updated.Time
	}
	return e, nil
}

// GetEvent reads one row gated by «requester is tutor OR student».
// V1 only resolves the student branch; V2 will extend with a UNION
// for circle membership.
func (p *Postgres) GetEvent(ctx context.Context, requesterID, eventID uuid.UUID) (domain.Event, error) {
	const q = `
		SELECT id, tutor_id, student_id, circle_id, title, body_md,
		       scheduled_at, duration_min, meet_url, capacity,
		       status, cancellation_reason, session_note,
		       visibility, shared_content_md, shared_at,
		       created_at, updated_at
		FROM tutor_events
		WHERE id = $1 AND (tutor_id = $2 OR student_id = $2)`
	row := p.pool.QueryRow(ctx, q, pgUUID(eventID), pgUUID(requesterID))
	out, err := scanEvent(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Event{}, fmt.Errorf("tutor.GetEvent: %w", domain.ErrNotFound)
		}
		return domain.Event{}, fmt.Errorf("tutor.GetEvent: %w", err)
	}
	return out, nil
}

// CompleteEvent stamps status=completed with a session note. Mirrors
// CancelEvent's terminal-detection — already-completed/cancelled rows
// return ErrInvalidInput so the use case can surface «session already
// closed» rather than silently confusing the tutor.
//
// The session_note is empty-checked at the use case layer; the SQL
// CHECK (tutor_events_session_note_pair) is defence-in-depth.
func (p *Postgres) CompleteEvent(ctx context.Context, tutorID, eventID uuid.UUID, note string, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE tutor_events
		SET status = 'completed',
		    session_note = $1,
		    updated_at = $2
		WHERE id = $3
		  AND tutor_id = $4
		  AND status = 'scheduled'`,
		note, pgtype.Timestamptz{Time: now, Valid: true},
		pgUUID(eventID), pgUUID(tutorID),
	)
	if err != nil {
		return fmt.Errorf("tutor.CompleteEvent: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Distinguish: nonexistent / not-yours vs already-terminal.
		var existsTerminal bool
		_ = p.pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM tutor_events
				 WHERE id = $1 AND tutor_id = $2 AND status <> 'scheduled'
			)`, pgUUID(eventID), pgUUID(tutorID)).Scan(&existsTerminal)
		if existsTerminal {
			return fmt.Errorf("tutor.CompleteEvent: %w", domain.ErrInvalidInput)
		}
		return fmt.Errorf("tutor.CompleteEvent: %w", domain.ErrNotFound)
	}
	return nil
}

// CancelEvent stamps status=cancelled with a reason. Already-terminal
// events return ErrInvalidInput so the use case can surface a toast
// rather than silently confusing the user.
func (p *Postgres) CancelEvent(ctx context.Context, tutorID, eventID uuid.UUID, reason string, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE tutor_events
		SET status = 'cancelled',
		    cancellation_reason = $1,
		    updated_at = $2
		WHERE id = $3
		  AND tutor_id = $4
		  AND status = 'scheduled'`,
		reason, pgtype.Timestamptz{Time: now, Valid: true},
		pgUUID(eventID), pgUUID(tutorID),
	)
	if err != nil {
		return fmt.Errorf("tutor.CancelEvent: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Distinguish: nonexistent / not-yours vs already-terminal.
		// One extra read; cheap and only on the rare contention path.
		var existsTerminal bool
		_ = p.pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM tutor_events
				 WHERE id = $1 AND tutor_id = $2 AND status <> 'scheduled'
			)`, pgUUID(eventID), pgUUID(tutorID)).Scan(&existsTerminal)
		if existsTerminal {
			return fmt.Errorf("tutor.CancelEvent: %w", domain.ErrInvalidInput)
		}
		return fmt.Errorf("tutor.CancelEvent: %w", domain.ErrNotFound)
	}
	return nil
}

// ListByTutorPaged — tutor's own events; includes cancelled rows so
// the dashboard can render «cancelled» status badges. Keyset cursor over
// (scheduled_at DESC, id DESC). cursor "" = first page.
func (p *Postgres) ListByTutorPaged(
	ctx context.Context, tutorID uuid.UUID, limit int, cursor string,
) ([]domain.Event, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	c, err := decodeScheduledAtCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListByTutor: %w", err)
	}
	args := []any{pgUUID(tutorID)}
	q := `
		SELECT id, tutor_id, student_id, circle_id, title, body_md,
		       scheduled_at, duration_min, meet_url, capacity,
		       status, cancellation_reason, session_note,
		       visibility, shared_content_md, shared_at,
		       created_at, updated_at
		FROM tutor_events
		WHERE tutor_id = $1`
	if !c.ScheduledAt.IsZero() {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("tutor.ListByTutor: cursor id: %w", parseErr)
		}
		args = append(args, c.ScheduledAt, pgUUID(cid))
		q += fmt.Sprintf(` AND (scheduled_at, id) < ($%d, $%d)`, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	q += fmt.Sprintf(` ORDER BY scheduled_at DESC, id DESC LIMIT $%d`, len(args))

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListByTutor: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Event, 0, limit)
	for rows.Next() {
		ev, scanErr := scanEvent(rows)
		if scanErr != nil {
			return nil, "", fmt.Errorf("tutor.ListByTutor: scan: %w", scanErr)
		}
		out = append(out, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("tutor.ListByTutor: %w", err)
	}
	var nextCursor string
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		nextCursor = encodeScheduledAtCursor(scheduledAtCursor{
			ScheduledAt: last.ScheduledAt,
			ID:          last.ID.String(),
		})
	}
	return out, nextCursor, nil
}

// ListUpcomingForStudentPaged — keyset cursor variant.
// Walks forward (scheduled_at ASC, id ASC) — so cursor advances older→newer
// because earliest-scheduled comes first.
func (p *Postgres) ListUpcomingForStudentPaged(
	ctx context.Context, studentID uuid.UUID, now time.Time, limit int, cursor string,
) ([]domain.Event, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 25
	}
	c, err := decodeScheduledAtCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListUpcomingForStudent: %w", err)
	}
	args := []any{
		pgUUID(studentID),
		pgtype.Timestamptz{Time: now, Valid: true},
	}
	q := `
		SELECT id, tutor_id, student_id, circle_id, title, body_md,
		       scheduled_at, duration_min, meet_url, capacity,
		       status, cancellation_reason, session_note,
		       visibility, shared_content_md, shared_at,
		       created_at, updated_at
		FROM tutor_events
		WHERE student_id = $1
		  AND status = 'scheduled'
		  AND (scheduled_at + (duration_min || ' minutes')::interval) > $2`
	if !c.ScheduledAt.IsZero() {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("tutor.ListUpcomingForStudent: cursor id: %w", parseErr)
		}
		args = append(args, c.ScheduledAt, pgUUID(cid))
		q += fmt.Sprintf(` AND (scheduled_at, id) > ($%d, $%d)`, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	q += fmt.Sprintf(` ORDER BY scheduled_at ASC, id ASC LIMIT $%d`, len(args))

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListUpcomingForStudent: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Event, 0, limit)
	for rows.Next() {
		ev, scanErr := scanEvent(rows)
		if scanErr != nil {
			return nil, "", fmt.Errorf("tutor.ListUpcomingForStudent: scan: %w", scanErr)
		}
		out = append(out, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("tutor.ListUpcomingForStudent: %w", err)
	}
	var nextCursor string
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		nextCursor = encodeScheduledAtCursor(scheduledAtCursor{
			ScheduledAt: last.ScheduledAt,
			ID:          last.ID.String(),
		})
	}
	return out, nextCursor, nil
}

// TutorEventStats — aggregate. Three queries, fail-soft per block
// (silently zeros if a sub-query errors). Active-student count
// reuses tutor_students; event aggregates over tutor_events filtered
// by `created_at >= now - window`.
func (p *Postgres) TutorEventStats(ctx context.Context, tutorID uuid.UUID, windowDays int, now time.Time) (domain.TutorActivity, error) {
	if windowDays <= 0 {
		windowDays = 30
	}
	out := domain.TutorActivity{WindowDays: windowDays}
	since := pgtype.Timestamptz{Time: now.AddDate(0, 0, -windowDays), Valid: true}

	// 1) Active student count.
	_ = p.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM tutor_students
		 WHERE tutor_id = $1 AND ended_at IS NULL`,
		pgUUID(tutorID),
	).Scan(&out.ActiveStudentCount)

	// 2) Event counters by status inside the window.
	_ = p.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE status = 'completed') AS completed,
			COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
			COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled,
			COALESCE(SUM(duration_min) FILTER (WHERE status = 'completed'), 0) AS minutes
		FROM tutor_events
		WHERE tutor_id = $1 AND created_at >= $2`,
		pgUUID(tutorID), since,
	).Scan(&out.EventsCompleted, &out.EventsCancelled, &out.EventsScheduled, &out.MinutesTaught)

	// 3) Cancellation rate — derived; safe-guard division by zero.
	denom := out.EventsCompleted + out.EventsCancelled
	if denom > 0 {
		out.CancellationRate = float64(out.EventsCancelled) / float64(denom)
	}

	// 4) Daily rolling series для sparkline UI. Inclusive window:
	// [now - windowDays, now]. generate_series даёт пустой ряд дней без
	// events, чтобы фронт получил массив фиксированной длины.
	out.DailyCompleted = make([]int, windowDays)
	out.DailyMinutes = make([]int, windowDays)
	rows, err := p.pool.Query(ctx, `
		WITH days AS (
		  SELECT generate_series(
		    (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day')::date,
		    CURRENT_DATE,
		    INTERVAL '1 day'
		  )::date AS day
		),
		buckets AS (
		  SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
		         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
		         COALESCE(SUM(duration_min) FILTER (WHERE status = 'completed'), 0) AS minutes
		  FROM tutor_events
		  WHERE tutor_id = $1
		    AND created_at >= CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day'
		  GROUP BY day
		)
		SELECT d.day,
		       COALESCE(b.completed, 0)::int,
		       COALESCE(b.minutes, 0)::int
		FROM days d LEFT JOIN buckets b ON b.day = d.day
		ORDER BY d.day ASC`,
		pgUUID(tutorID), windowDays,
	)
	if err == nil {
		defer rows.Close()
		idx := 0
		for rows.Next() && idx < windowDays {
			var day time.Time
			var completed, minutes int
			if scanErr := rows.Scan(&day, &completed, &minutes); scanErr == nil {
				out.DailyCompleted[idx] = completed
				out.DailyMinutes[idx] = minutes
			}
			idx++
		}
	}
	return out, nil
}

// TutorsActivitySummary — student-facing social-proof aggregate over
// a list of tutor_ids. Three sub-queries
// run in a single round-trip via UNION-ed CTEs:
//   1. LastActiveAt — MAX of created_at/scheduled_at/COALESCE updated_at
//      over all events authored by each tutor.
//   2. ActiveStudentCountOther — COUNT(tutor_students) - 1 if caller is
//      a student of that tutor (it always is via the ListMyTutors
//      pre-filter, but we still GREATEST-clamp to 0 defensively).
//   3. RecentEventsCount — COUNT(tutor_events) inside windowDays.
// Privacy: no event titles / body / per-student rows returned —
// aggregate-only by design. Missing tutorIDs absent from the result.
func (p *Postgres) TutorsActivitySummary(
	ctx context.Context,
	callerID uuid.UUID,
	tutorIDs []uuid.UUID,
	windowDays int,
	now time.Time,
) (map[uuid.UUID]domain.MyTutorActivity, error) {
	out := make(map[uuid.UUID]domain.MyTutorActivity, len(tutorIDs))
	if len(tutorIDs) == 0 {
		return out, nil
	}
	if windowDays <= 0 {
		windowDays = 7
	}
	if windowDays > 30 {
		windowDays = 30
	}
	since := pgtype.Timestamptz{Time: now.AddDate(0, 0, -windowDays), Valid: true}

	// One SQL round-trip via LEFT JOIN over CTEs.
	const q = `
		WITH tutor_ids AS (
			SELECT unnest($1::uuid[]) AS tutor_id
		),
		last_active AS (
			SELECT t.tutor_id,
			       MAX(GREATEST(
			           COALESCE(e.created_at, 'epoch'::timestamptz),
			           COALESCE(e.scheduled_at, 'epoch'::timestamptz),
			           COALESCE(e.updated_at, 'epoch'::timestamptz)
			       )) AS last_active_at
			FROM tutor_ids t
			LEFT JOIN tutor_events e ON e.tutor_id = t.tutor_id
			GROUP BY t.tutor_id
		),
		other_students AS (
			SELECT t.tutor_id,
			       COUNT(*) FILTER (
			           WHERE ts.ended_at IS NULL AND ts.student_id <> $2
			       )::int AS other_count
			FROM tutor_ids t
			LEFT JOIN tutor_students ts ON ts.tutor_id = t.tutor_id
			GROUP BY t.tutor_id
		),
		recent_events AS (
			SELECT t.tutor_id,
			       COUNT(*) FILTER (WHERE e.created_at >= $3)::int AS recent_count
			FROM tutor_ids t
			LEFT JOIN tutor_events e ON e.tutor_id = t.tutor_id
			GROUP BY t.tutor_id
		)
		SELECT t.tutor_id,
		       la.last_active_at,
		       COALESCE(os.other_count, 0),
		       COALESCE(re.recent_count, 0)
		FROM tutor_ids t
		LEFT JOIN last_active     la ON la.tutor_id = t.tutor_id
		LEFT JOIN other_students  os ON os.tutor_id = t.tutor_id
		LEFT JOIN recent_events   re ON re.tutor_id = t.tutor_id`

	rows, err := p.pool.Query(ctx, q, tutorIDs, pgUUID(callerID), since)
	if err != nil {
		return nil, fmt.Errorf("tutor.TutorsActivitySummary: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id       pgtype.UUID
			lastAct  pgtype.Timestamptz
			others   int
			recent   int
		)
		if err := rows.Scan(&id, &lastAct, &others, &recent); err != nil {
			return nil, fmt.Errorf("tutor.TutorsActivitySummary: scan: %w", err)
		}
		tutorID := uuidFrom(id)
		summary := domain.MyTutorActivity{
			TutorID:                 tutorID,
			ActiveStudentCountOther: others,
			RecentEventsCount:       recent,
		}
		if lastAct.Valid {
			// «epoch» fallback from COALESCE shows up when there are no
			// events at all — treat that as «never active», zero-time.
			if lastAct.Time.Year() > 1970 {
				summary.LastActiveAt = lastAct.Time
			}
		}
		// Defensive clamp — should never be negative given COUNT > 0 always.
		if summary.ActiveStudentCountOther < 0 {
			summary.ActiveStudentCountOther = 0
		}
		out[tutorID] = summary
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tutor.TutorsActivitySummary: rows: %w", err)
	}
	return out, nil
}

// ── Group events on circles ───────────────────────────────────────────

// EnsureCircleOwner — tutor must be circle.owner OR have admin role
// in circle_members. Returns ErrNotFound on either «no such circle» or
// «not your circle» (cross-user leak protection).
func (p *Postgres) EnsureCircleOwner(ctx context.Context, tutorID, circleID uuid.UUID) error {
	var ok bool
	if err := p.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM circles WHERE id = $2 AND owner_id = $1
		) OR EXISTS (
			SELECT 1 FROM circle_members
			 WHERE circle_id = $2 AND user_id = $1 AND role IN ('admin','owner')
		)`,
		pgUUID(tutorID), pgUUID(circleID),
	).Scan(&ok); err != nil {
		return fmt.Errorf("tutor.EnsureCircleOwner: %w", err)
	}
	if !ok {
		return fmt.Errorf("tutor.EnsureCircleOwner: %w", domain.ErrNotFound)
	}
	return nil
}

// EnsureCircleMember — student must be in circle_members for the
// circle to see / join its events.
func (p *Postgres) EnsureCircleMember(ctx context.Context, studentID, circleID uuid.UUID) error {
	var ok bool
	if err := p.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM circle_members
			 WHERE circle_id = $2 AND user_id = $1
		)`,
		pgUUID(studentID), pgUUID(circleID),
	).Scan(&ok); err != nil {
		return fmt.Errorf("tutor.EnsureCircleMember: %w", err)
	}
	if !ok {
		return fmt.Errorf("tutor.EnsureCircleMember: %w", domain.ErrNotFound)
	}
	return nil
}

// JoinEvent — atomic capacity-respecting RSVP insert. SERIALIZABLE
// would be the textbook fix for capacity races; we use READ COMMITTED
// + a SELECT count inside the same tx + INSERT ... WHERE COUNT < cap
// pattern: cheap, race-window of «two students join the last seat at
// the exact same millisecond» degrades to one user ending up over by
// one — acceptable trade-off for tutor-classroom load (tens of
// concurrent users, not millions).
func (p *Postgres) JoinEvent(ctx context.Context, studentID, eventID uuid.UUID, now time.Time) error {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("tutor.JoinEvent: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1) Verify event exists, is scheduled, and is a circle event with
	//    a capacity (1-on-1 events have no RSVP flow).
	var (
		status   string
		capacity pgtype.Int4
	)
	if err := tx.QueryRow(ctx, `
		SELECT status, capacity FROM tutor_events
		 WHERE id = $1 AND circle_id IS NOT NULL`,
		pgUUID(eventID),
	).Scan(&status, &capacity); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("tutor.JoinEvent: %w", domain.ErrNotFound)
		}
		return fmt.Errorf("tutor.JoinEvent: lookup: %w", err)
	}
	if status != "scheduled" {
		return fmt.Errorf("tutor.JoinEvent: %w", domain.ErrInvalidInput)
	}

	// 2) Check current count vs capacity. NULL capacity = unlimited.
	if capacity.Valid {
		var count int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM tutor_event_rsvps WHERE event_id = $1`,
			pgUUID(eventID),
		).Scan(&count); err != nil {
			return fmt.Errorf("tutor.JoinEvent: count: %w", err)
		}
		// Allow a re-join from the same student to NOT count as a new
		// seat — check their existing membership before the cap reject.
		var alreadyIn bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM tutor_event_rsvps
				 WHERE event_id = $1 AND student_id = $2
			)`,
			pgUUID(eventID), pgUUID(studentID),
		).Scan(&alreadyIn); err != nil {
			return fmt.Errorf("tutor.JoinEvent: dedup-check: %w", err)
		}
		if !alreadyIn && count >= int(capacity.Int32) {
			return fmt.Errorf("tutor.JoinEvent: %w", domain.ErrCapacityFull)
		}
	}

	// 3) Idempotent insert.
	if _, err := tx.Exec(ctx, `
		INSERT INTO tutor_event_rsvps (event_id, student_id, joined_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (event_id, student_id) DO NOTHING`,
		pgUUID(eventID), pgUUID(studentID),
		pgtype.Timestamptz{Time: now, Valid: true},
	); err != nil {
		return fmt.Errorf("tutor.JoinEvent: insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("tutor.JoinEvent: commit: %w", err)
	}
	return nil
}

// LeaveEvent — idempotent delete. «Already not in» degrades to no-op.
func (p *Postgres) LeaveEvent(ctx context.Context, studentID, eventID uuid.UUID) error {
	if _, err := p.pool.Exec(ctx, `
		DELETE FROM tutor_event_rsvps
		 WHERE event_id = $1 AND student_id = $2`,
		pgUUID(eventID), pgUUID(studentID),
	); err != nil {
		return fmt.Errorf("tutor.LeaveEvent: %w", err)
	}
	return nil
}

// ListEventRSVPCount — count-only; cheap (idx_tutor_event_rsvps_event).
func (p *Postgres) ListEventRSVPCount(ctx context.Context, eventID uuid.UUID) (int, error) {
	var count int
	if err := p.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM tutor_event_rsvps WHERE event_id = $1`,
		pgUUID(eventID),
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("tutor.ListEventRSVPCount: %w", err)
	}
	return count, nil
}

// ListUpcomingGroupEventsForStudent — events on circles the student is
// a member of, scheduled, end-time-in-future. JOIN over circle_members
// to filter by membership; same time-window logic as
// ListUpcomingForStudent (1-on-1 path).
func (p *Postgres) ListUpcomingGroupEventsForStudent(ctx context.Context, studentID uuid.UUID, now time.Time, limit int) ([]domain.Event, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	const q = `
		SELECT e.id, e.tutor_id, e.student_id, e.circle_id, e.title, e.body_md,
		       e.scheduled_at, e.duration_min, e.meet_url, e.capacity,
		       e.status, e.cancellation_reason, e.session_note,
		       e.visibility, e.shared_content_md, e.shared_at,
		       e.created_at, e.updated_at
		FROM tutor_events e
		JOIN circle_members cm ON cm.circle_id = e.circle_id AND cm.user_id = $1
		WHERE e.circle_id IS NOT NULL
		  AND e.status = 'scheduled'
		  AND (e.scheduled_at + (e.duration_min || ' minutes')::interval) > $2
		ORDER BY e.scheduled_at ASC
		LIMIT $3`
	rows, err := p.pool.Query(ctx, q,
		pgUUID(studentID),
		pgtype.Timestamptz{Time: now, Valid: true},
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListUpcomingGroupEventsForStudent: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Event, 0, 8)
	for rows.Next() {
		ev, err := scanEvent(rows)
		if err != nil {
			return nil, fmt.Errorf("tutor.ListUpcomingGroupEventsForStudent: scan: %w", err)
		}
		out = append(out, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tutor.ListUpcomingGroupEventsForStudent: %w", err)
	}
	return out, nil
}

// ── Session-note visibility ──────────────────────────────────────────

// SetSessionNoteVisibility — toggle private↔shared + optional curated copy.
// Conditional shared_at update: stamps on FIRST private→shared transition
// (where shared_at IS NULL), refreshes on re-share, preserved on toggle
// back to private (audit trail).
//
// Gates (in order):
//   1) event must exist and be owned by tutorID → else ErrNotFound
//   2) event must be status='completed' → else ErrInvalidInput (can't
//      share a note that doesn't exist yet)
// Visibility/value validation happens at the use case layer; SQL CHECK
// is defence-in-depth.
func (p *Postgres) SetSessionNoteVisibility(
	ctx context.Context,
	tutorID, eventID uuid.UUID,
	visibility domain.EventVisibility,
	sharedContentMD string,
	now time.Time,
) (domain.Event, error) {
	// Single UPDATE с conditional shared_at: NULLIF + COALESCE chain
	// keeps the first-stamp/preservation semantics atomic. When toggling
	// to private we don't touch shared_at; when toggling to shared we
	// set shared_at if NULL, else refresh.
	const q = `
		UPDATE tutor_events
		   SET visibility = $1,
		       shared_content_md = $2,
		       shared_at = CASE
		           WHEN $1 = 'shared' THEN $3
		           ELSE shared_at
		       END,
		       updated_at = $3
		 WHERE id = $4
		   AND tutor_id = $5
		   AND status = 'completed'
		RETURNING id, tutor_id, student_id, circle_id, title, body_md,
		          scheduled_at, duration_min, meet_url, capacity,
		          status, cancellation_reason, session_note,
		          visibility, shared_content_md, shared_at,
		          created_at, updated_at`
	row := p.pool.QueryRow(ctx, q,
		string(visibility), sharedContentMD,
		pgtype.Timestamptz{Time: now, Valid: true},
		pgUUID(eventID), pgUUID(tutorID),
	)
	out, err := scanEvent(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Distinguish: «event not yours / doesn't exist» vs «not yet
			// completed». The use case caller wants different errors for
			// each (NotFound vs FailedPrecondition).
			var existsNotCompleted bool
			_ = p.pool.QueryRow(ctx, `
				SELECT EXISTS (
					SELECT 1 FROM tutor_events
					 WHERE id = $1 AND tutor_id = $2 AND status <> 'completed'
				)`, pgUUID(eventID), pgUUID(tutorID)).Scan(&existsNotCompleted)
			if existsNotCompleted {
				return domain.Event{}, fmt.Errorf("tutor.SetSessionNoteVisibility: %w", domain.ErrInvalidInput)
			}
			return domain.Event{}, fmt.Errorf("tutor.SetSessionNoteVisibility: %w", domain.ErrNotFound)
		}
		return domain.Event{}, fmt.Errorf("tutor.SetSessionNoteVisibility: %w", err)
	}
	return out, nil
}

// ListSharedSessionNotesForStudent — student-side feed of completed
// events whose tutor opted to share the session note. Joined с users
// для tutor display_name + avatar; COALESCE resolves shared_content_md
// → session_note fallback at SQL layer so domain callers always see
// non-empty content.
//
// Keyset cursor: shared_at DESC, event_id DESC. Hits the partial idx
// idx_tutor_events_student_shared.
func (p *Postgres) ListSharedSessionNotesForStudent(
	ctx context.Context,
	studentID uuid.UUID,
	limit int,
	cursor string,
) ([]domain.SharedSessionNote, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 25
	}
	c, err := decodeScheduledAtCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListSharedSessionNotesForStudent: %w", err)
	}
	args := []any{pgUUID(studentID)}
	q := `
		SELECT e.id, e.title, e.tutor_id,
		       COALESCE(u.display_name, u.username, '')      AS tutor_display_name,
		       COALESCE(u.avatar_url, '')                    AS tutor_avatar_url,
		       e.scheduled_at, e.shared_at,
		       CASE
		           WHEN e.shared_content_md <> '' THEN e.shared_content_md
		           ELSE e.session_note
		       END AS resolved_md
		  FROM tutor_events e
		  LEFT JOIN users u ON u.id = e.tutor_id
		 WHERE e.student_id = $1
		   AND e.status = 'completed'
		   AND e.visibility = 'shared'`
	if !c.ScheduledAt.IsZero() {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("tutor.ListSharedSessionNotesForStudent: cursor id: %w", parseErr)
		}
		args = append(args, c.ScheduledAt, pgUUID(cid))
		q += fmt.Sprintf(` AND (e.shared_at, e.id) < ($%d, $%d)`, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	q += fmt.Sprintf(` ORDER BY e.shared_at DESC, e.id DESC LIMIT $%d`, len(args))

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListSharedSessionNotesForStudent: %w", err)
	}
	defer rows.Close()
	out := make([]domain.SharedSessionNote, 0, limit)
	for rows.Next() {
		var (
			eventID, tutorID         pgtype.UUID
			title, displayName, av   string
			resolvedMD               string
			scheduledAt, sharedAt    pgtype.Timestamptz
		)
		if scanErr := rows.Scan(
			&eventID, &title, &tutorID, &displayName, &av,
			&scheduledAt, &sharedAt, &resolvedMD,
		); scanErr != nil {
			return nil, "", fmt.Errorf("tutor.ListSharedSessionNotesForStudent: scan: %w", scanErr)
		}
		n := domain.SharedSessionNote{
			EventID:          uuidFrom(eventID),
			EventTitle:       title,
			TutorID:          uuidFrom(tutorID),
			TutorDisplayName: displayName,
			TutorAvatarURL:   av,
			SharedContentMD:  resolvedMD,
		}
		if scheduledAt.Valid {
			n.ScheduledAt = scheduledAt.Time
		}
		if sharedAt.Valid {
			n.SharedAt = sharedAt.Time
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("tutor.ListSharedSessionNotesForStudent: %w", err)
	}
	var nextCursor string
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		nextCursor = encodeScheduledAtCursor(scheduledAtCursor{
			ScheduledAt: last.SharedAt,
			ID:          last.EventID.String(),
		})
	}
	return out, nextCursor, nil
}

// ── helpers ────────────────────────────────────────────────────────

func scanEvent(r rowScanner) (domain.Event, error) {
	var (
		id, tutorID                        pgtype.UUID
		studentID, circleID                pgtype.UUID
		title, body, meetURL               string
		scheduledAt, createdAt, updatedAt  pgtype.Timestamptz
		sharedAt                           pgtype.Timestamptz
		durationMin                        int
		capacity                           pgtype.Int4
		status, cancellation, sessionNote  string
		visibility, sharedContentMD        string
	)
	if err := r.Scan(
		&id, &tutorID, &studentID, &circleID,
		&title, &body, &scheduledAt, &durationMin, &meetURL, &capacity,
		&status, &cancellation, &sessionNote,
		&visibility, &sharedContentMD, &sharedAt,
		&createdAt, &updatedAt,
	); err != nil {
		return domain.Event{}, fmt.Errorf("scanEvent: %w", err)
	}
	ev := domain.Event{
		ID:                 uuidFrom(id),
		TutorID:            uuidFrom(tutorID),
		Title:              title,
		BodyMD:             body,
		DurationMin:        durationMin,
		MeetURL:            meetURL,
		Status:             domain.EventStatus(status),
		CancellationReason: cancellation,
		SessionNote:        sessionNote,
		Visibility:         domain.EventVisibility(visibility),
		SharedContentMD:    sharedContentMD,
	}
	if studentID.Valid {
		sid := uuidFrom(studentID)
		ev.StudentID = &sid
	}
	if circleID.Valid {
		cid := uuidFrom(circleID)
		ev.CircleID = &cid
	}
	if scheduledAt.Valid {
		ev.ScheduledAt = scheduledAt.Time
	}
	if capacity.Valid {
		v := int(capacity.Int32)
		ev.Capacity = &v
	}
	if sharedAt.Valid {
		ev.SharedAt = sharedAt.Time
	}
	if createdAt.Valid {
		ev.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		ev.UpdatedAt = updatedAt.Time
	}
	return ev, nil
}

// nullablePgUUID handles the «nil → SQL NULL, set → SQL UUID» mapping
// for the event's optional student_id / circle_id columns.
func nullablePgUUID(p *uuid.UUID) pgtype.UUID {
	if p == nil {
		return pgtype.UUID{}
	}
	return pgUUID(*p)
}
