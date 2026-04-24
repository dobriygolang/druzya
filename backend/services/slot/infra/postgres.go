// Package infra holds Postgres adapters and the MeetRoomProvider stub for the
// slot domain. Queries are served by the sqlc-generated slotdb package; a
// small number of dynamic queries (filtered listing) stay hand-rolled.
package infra

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/shared/enums"
	"druz9/slot/domain"
	slotdb "druz9/slot/infra/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// defaultListLimit caps the public availability feed.
const defaultListLimit = 100

// Postgres implements domain.SlotRepo / BookingRepo / ReviewRepo on a
// *pgxpool.Pool via sqlc-generated queries.
type Postgres struct {
	pool *pgxpool.Pool
	q    *slotdb.Queries
}

// NewPostgres wires a Postgres repo.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: slotdb.New(pool)}
}

// ── SlotRepo ───────────────────────────────────────────────────────────────

// Create inserts a new slot row.
func (p *Postgres) Create(ctx context.Context, s domain.Slot) (domain.Slot, error) {
	var diff pgtype.Text
	if s.Difficulty != nil {
		diff = pgtype.Text{String: string(*s.Difficulty), Valid: true}
	}
	row, err := p.q.CreateSlot(ctx, slotdb.CreateSlotParams{
		InterviewerID: pgUUID(s.InterviewerID),
		StartsAt:      pgtype.Timestamptz{Time: s.StartsAt.UTC(), Valid: true},
		DurationMin:   int32(s.DurationMin),
		Section:       string(s.Section),
		Difficulty:    diff,
		Language:      s.Language,
		PriceRub:      int32(s.PriceRub),
		Column8:       s.MeetURL,
	})
	if err != nil {
		return domain.Slot{}, fmt.Errorf("slot.pg.Create: %w", err)
	}
	return slotFromRow(row), nil
}

// GetByID returns a slot by id.
func (p *Postgres) GetByID(ctx context.Context, id uuid.UUID) (domain.Slot, error) {
	row, err := p.q.GetSlot(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Slot{}, domain.ErrNotFound
		}
		return domain.Slot{}, fmt.Errorf("slot.pg.GetByID: %w", err)
	}
	return slotFromRow(row), nil
}

// List returns filtered, upcoming, available slots.
//
// NOTE: sqlc does not cleanly model optional predicates that flip in and out
// of the WHERE clause across multiple dimensions, so this query is composed
// by hand. Security-wise every variable goes through positional binds.
func (p *Postgres) List(ctx context.Context, f domain.ListFilter) ([]domain.Slot, error) {
	var (
		clauses = []string{"status = 'available'", "starts_at > now()"}
		args    []any
	)
	argPos := func() string {
		return fmt.Sprintf("$%d", len(args)+1)
	}
	if f.Section != nil && *f.Section != "" {
		clauses = append(clauses, "section = "+argPos())
		args = append(args, string(*f.Section))
	}
	if f.Difficulty != nil && *f.Difficulty != "" {
		clauses = append(clauses, "difficulty = "+argPos())
		args = append(args, string(*f.Difficulty))
	}
	if f.From != nil {
		clauses = append(clauses, "starts_at >= "+argPos())
		args = append(args, f.From.UTC())
	}
	if f.To != nil {
		clauses = append(clauses, "starts_at <= "+argPos())
		args = append(args, f.To.UTC())
	}
	if f.PriceMax != nil {
		clauses = append(clauses, "price_rub <= "+argPos())
		args = append(args, int32(*f.PriceMax))
	}
	limit := f.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	clauses = append(clauses, "")
	sql := `SELECT id, interviewer_id, starts_at, duration_min, section, difficulty,
	       language, price_rub, status, created_at, meet_url
	   FROM slots
	  WHERE ` + strings.Join(clauses[:len(clauses)-1], " AND ") +
		fmt.Sprintf(" ORDER BY starts_at ASC LIMIT %d", limit)

	rows, err := p.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("slot.pg.List: %w", err)
	}
	defer rows.Close()

	out := make([]domain.Slot, 0)
	for rows.Next() {
		var r slotdb.Slot
		if err := rows.Scan(
			&r.ID, &r.InterviewerID, &r.StartsAt, &r.DurationMin,
			&r.Section, &r.Difficulty, &r.Language, &r.PriceRub,
			&r.Status, &r.CreatedAt, &r.MeetUrl,
		); err != nil {
			return nil, fmt.Errorf("slot.pg.List: scan: %w", err)
		}
		out = append(out, slotFromRow(r))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("slot.pg.List: rows: %w", err)
	}
	return out, nil
}

// ListByInterviewer returns overlapping slots of the given owner.
func (p *Postgres) ListByInterviewer(ctx context.Context, interviewerID uuid.UUID, from, to time.Time) ([]domain.Slot, error) {
	rows, err := p.q.ListByInterviewerInRange(ctx, slotdb.ListByInterviewerInRangeParams{
		InterviewerID: pgUUID(interviewerID),
		Column2:       pgtype.Timestamptz{Time: from.UTC(), Valid: true},
		Column3:       pgtype.Timestamptz{Time: to.UTC(), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("slot.pg.ListByInterviewer: %w", err)
	}
	out := make([]domain.Slot, 0, len(rows))
	for _, r := range rows {
		out = append(out, slotFromRow(r))
	}
	return out, nil
}

// UpdateStatus sets the status column (non-transactional).
func (p *Postgres) UpdateStatus(ctx context.Context, id uuid.UUID, status string) error {
	affected, err := p.q.UpdateSlotStatus(ctx, slotdb.UpdateSlotStatusParams{
		ID:     pgUUID(id),
		Status: status,
	})
	if err != nil {
		return fmt.Errorf("slot.pg.UpdateStatus: %w", err)
	}
	if affected == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// BookAtomically locks the slot, verifies it is bookable, flips its status
// and inserts the booking row — all in a single transaction.
func (p *Postgres) BookAtomically(ctx context.Context, slotID, candidateID uuid.UUID, meetURL string) (domain.Booking, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return domain.Booking{}, fmt.Errorf("slot.pg.BookAtomically: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qtx := p.q.WithTx(tx)

	row, err := qtx.GetSlotForUpdate(ctx, pgUUID(slotID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Booking{}, domain.ErrNotFound
		}
		return domain.Booking{}, fmt.Errorf("slot.pg.BookAtomically: lock: %w", err)
	}
	s := slotFromRow(row)
	if string(s.Status) != string(enums.SlotStatusAvailable) {
		return domain.Booking{}, domain.ErrNotAvailable
	}
	if !s.StartsAt.After(time.Now().UTC()) {
		return domain.Booking{}, domain.ErrPastStart
	}
	if s.InterviewerID == candidateID {
		return domain.Booking{}, domain.ErrSelfBooking
	}

	if affected, updErr := qtx.UpdateSlotStatus(ctx, slotdb.UpdateSlotStatusParams{
		ID:     pgUUID(slotID),
		Status: string(enums.SlotStatusBooked),
	}); updErr != nil {
		return domain.Booking{}, fmt.Errorf("slot.pg.BookAtomically: flip: %w", updErr)
	} else if affected == 0 {
		return domain.Booking{}, domain.ErrNotFound
	}

	brow, err := qtx.CreateBooking(ctx, slotdb.CreateBookingParams{
		SlotID:      pgUUID(slotID),
		CandidateID: pgUUID(candidateID),
		MeetUrl:     pgtype.Text{String: meetURL, Valid: meetURL != ""},
	})
	if err != nil {
		return domain.Booking{}, fmt.Errorf("slot.pg.BookAtomically: booking: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.Booking{}, fmt.Errorf("slot.pg.BookAtomically: commit: %w", err)
	}
	return bookingFromRow(brow), nil
}

// CancelSlotWithBooking cancels the slot and any attached booking atomically.
// Returns the cancelled booking when present so the caller can notify the
// candidate.
func (p *Postgres) CancelSlotWithBooking(ctx context.Context, slotID uuid.UUID) (domain.Booking, bool, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return domain.Booking{}, false, fmt.Errorf("slot.pg.CancelSlotWithBooking: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qtx := p.q.WithTx(tx)

	row, err := qtx.GetSlotForUpdate(ctx, pgUUID(slotID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Booking{}, false, domain.ErrNotFound
		}
		return domain.Booking{}, false, fmt.Errorf("slot.pg.CancelSlotWithBooking: lock: %w", err)
	}
	s := slotFromRow(row)

	// Load the booking (if any) BEFORE cancelling so we can notify.
	var booking domain.Booking
	hadBooking := false
	if string(s.Status) == string(enums.SlotStatusBooked) {
		brow, berr := qtx.GetBookingBySlotID(ctx, pgUUID(slotID))
		if berr != nil && !errors.Is(berr, pgx.ErrNoRows) {
			return domain.Booking{}, false, fmt.Errorf("slot.pg.CancelSlotWithBooking: load booking: %w", berr)
		}
		if berr == nil {
			booking = bookingFromRow(brow)
			hadBooking = true
		}
	}

	if _, err := qtx.UpdateSlotStatus(ctx, slotdb.UpdateSlotStatusParams{
		ID:     pgUUID(slotID),
		Status: string(enums.SlotStatusCancelled),
	}); err != nil {
		return domain.Booking{}, false, fmt.Errorf("slot.pg.CancelSlotWithBooking: flip: %w", err)
	}
	if hadBooking {
		if _, err := qtx.CancelBookingBySlotID(ctx, pgUUID(slotID)); err != nil {
			return domain.Booking{}, false, fmt.Errorf("slot.pg.CancelSlotWithBooking: cancel booking: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.Booking{}, false, fmt.Errorf("slot.pg.CancelSlotWithBooking: commit: %w", err)
	}
	return booking, hadBooking, nil
}

// ── BookingRepo ────────────────────────────────────────────────────────────

// GetBySlotID returns the booking attached to a slot.
func (p *Postgres) GetBySlotID(ctx context.Context, slotID uuid.UUID) (domain.Booking, error) {
	row, err := p.q.GetBookingBySlotID(ctx, pgUUID(slotID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Booking{}, domain.ErrBookingNotFound
		}
		return domain.Booking{}, fmt.Errorf("slot.pg.GetBySlotID: %w", err)
	}
	return bookingFromRow(row), nil
}

// GetWithSlotByID returns a single booking joined with its parent slot, by
// booking id. ErrBookingNotFound when missing. Used cross-service by
// review.CreateReview.
func (p *Postgres) GetWithSlotByID(ctx context.Context, bookingID uuid.UUID) (domain.BookingWithSlot, error) {
	const sql = `
SELECT b.id, b.slot_id, b.candidate_id, b.meet_url, b.status, b.created_at,
       s.id, s.interviewer_id, s.starts_at, s.duration_min, s.section,
       s.difficulty, s.language, s.price_rub, s.status, s.created_at
  FROM bookings b
  JOIN slots    s ON s.id = b.slot_id
 WHERE b.id = $1`
	row := p.pool.QueryRow(ctx, sql, pgUUID(bookingID))
	var (
		b slotdb.Booking
		s slotdb.Slot
	)
	if err := row.Scan(
		&b.ID, &b.SlotID, &b.CandidateID, &b.MeetUrl, &b.Status, &b.CreatedAt,
		&s.ID, &s.InterviewerID, &s.StartsAt, &s.DurationMin, &s.Section,
		&s.Difficulty, &s.Language, &s.PriceRub, &s.Status, &s.CreatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.BookingWithSlot{}, domain.ErrBookingNotFound
		}
		return domain.BookingWithSlot{}, fmt.Errorf("slot.pg.GetByID: %w", err)
	}
	return domain.BookingWithSlot{
		Booking: bookingFromRow(b),
		Slot:    slotFromRow(s),
	}, nil
}

// ListHostedByInterviewer returns every booking on slots OWNED by the given
// interviewer, joined with candidate username for the drawer.
func (p *Postgres) ListHostedByInterviewer(ctx context.Context, interviewerID uuid.UUID) ([]domain.HostedBooking, error) {
	const sql = `
SELECT b.id, b.slot_id, b.candidate_id, b.meet_url, b.status, b.created_at,
       s.id, s.interviewer_id, s.starts_at, s.duration_min, s.section,
       s.difficulty, s.language, s.price_rub, s.status, s.created_at,
       u.username
  FROM bookings b
  JOIN slots    s ON s.id = b.slot_id
  JOIN users    u ON u.id = b.candidate_id
 WHERE s.interviewer_id = $1
 ORDER BY s.starts_at DESC`
	rows, err := p.pool.Query(ctx, sql, pgUUID(interviewerID))
	if err != nil {
		return nil, fmt.Errorf("slot.pg.ListHostedByInterviewer: %w", err)
	}
	defer rows.Close()
	out := make([]domain.HostedBooking, 0)
	for rows.Next() {
		var (
			b        slotdb.Booking
			s        slotdb.Slot
			username string
		)
		if err := rows.Scan(
			&b.ID, &b.SlotID, &b.CandidateID, &b.MeetUrl, &b.Status, &b.CreatedAt,
			&s.ID, &s.InterviewerID, &s.StartsAt, &s.DurationMin, &s.Section,
			&s.Difficulty, &s.Language, &s.PriceRub, &s.Status, &s.CreatedAt,
			&username,
		); err != nil {
			return nil, fmt.Errorf("slot.pg.ListHostedByInterviewer: scan: %w", err)
		}
		out = append(out, domain.HostedBooking{
			Booking:           bookingFromRow(b),
			Slot:              slotFromRow(s),
			CandidateUsername: username,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("slot.pg.ListHostedByInterviewer: rows: %w", err)
	}
	return out, nil
}

// ListByCandidate returns every booking the candidate owns joined with the
// parent slot, newest-future-first. Implemented with a hand-rolled query
// because sqlc would require a generated row-struct identical to a Slot+Booking
// composite — the read-only model lives only here so the query stays inline.
func (p *Postgres) ListByCandidate(ctx context.Context, candidateID uuid.UUID) ([]domain.BookingWithSlot, error) {
	const sql = `
SELECT b.id, b.slot_id, b.candidate_id, b.meet_url, b.status, b.created_at,
       s.id, s.interviewer_id, s.starts_at, s.duration_min, s.section,
       s.difficulty, s.language, s.price_rub, s.status, s.created_at
  FROM bookings b
  JOIN slots    s ON s.id = b.slot_id
 WHERE b.candidate_id = $1
 ORDER BY s.starts_at DESC`
	rows, err := p.pool.Query(ctx, sql, pgUUID(candidateID))
	if err != nil {
		return nil, fmt.Errorf("slot.pg.ListByCandidate: %w", err)
	}
	defer rows.Close()
	out := make([]domain.BookingWithSlot, 0)
	for rows.Next() {
		var (
			b slotdb.Booking
			s slotdb.Slot
		)
		if err := rows.Scan(
			&b.ID, &b.SlotID, &b.CandidateID, &b.MeetUrl, &b.Status, &b.CreatedAt,
			&s.ID, &s.InterviewerID, &s.StartsAt, &s.DurationMin, &s.Section,
			&s.Difficulty, &s.Language, &s.PriceRub, &s.Status, &s.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("slot.pg.ListByCandidate: scan: %w", err)
		}
		out = append(out, domain.BookingWithSlot{
			Booking: bookingFromRow(b),
			Slot:    slotFromRow(s),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("slot.pg.ListByCandidate: rows: %w", err)
	}
	return out, nil
}

// ── helpers ────────────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func slotFromRow(r slotdb.Slot) domain.Slot {
	s := domain.Slot{
		ID:            fromPgUUID(r.ID),
		InterviewerID: fromPgUUID(r.InterviewerID),
		StartsAt:      r.StartsAt.Time,
		DurationMin:   int(r.DurationMin),
		Section:       enums.Section(r.Section),
		Language:      r.Language,
		PriceRub:      int(r.PriceRub),
		Status:        enums.SlotStatus(r.Status),
		CreatedAt:     r.CreatedAt.Time,
	}
	if r.Difficulty.Valid {
		d := enums.Difficulty(r.Difficulty.String)
		s.Difficulty = &d
	}
	if r.MeetUrl.Valid {
		s.MeetURL = r.MeetUrl.String
	}
	return s
}

func bookingFromRow(r slotdb.Booking) domain.Booking {
	b := domain.Booking{
		ID:          fromPgUUID(r.ID),
		SlotID:      fromPgUUID(r.SlotID),
		CandidateID: fromPgUUID(r.CandidateID),
		Status:      r.Status,
		CreatedAt:   r.CreatedAt.Time,
	}
	if r.MeetUrl.Valid {
		b.MeetURL = r.MeetUrl.String
	}
	return b
}

// Interface guards. ReviewRepo / BookingHasReviewProvider are NOT satisfied
// here — the implementations live in /Users/sedorofeevd/Desktop/druzya/backend/services/review
// and are wired into the slot use cases at the monolith layer.
var (
	_ domain.SlotRepo    = (*Postgres)(nil)
	_ domain.BookingRepo = (*Postgres)(nil)
)
