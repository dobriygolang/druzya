// Package infra — hand-rolled pgx adapters for events.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/events/domain"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Events struct {
	pool *pgxpool.Pool
}

func NewEvents(pool *pgxpool.Pool) *Events { return &Events{pool: pool} }

func (r *Events) Create(ctx context.Context, e domain.Event) (domain.Event, error) {
	var (
		id        pgtype.UUID
		createdAt time.Time
	)
	editorRoom := pgtype.UUID{}
	if e.EditorRoomID != nil {
		editorRoom = sharedpg.UUID(*e.EditorRoomID)
	}
	whiteboardRoom := pgtype.UUID{}
	if e.WhiteboardRoomID != nil {
		whiteboardRoom = sharedpg.UUID(*e.WhiteboardRoomID)
	}
	if e.Recurrence == "" {
		e.Recurrence = domain.RecurrenceNone
	}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO events (id, circle_id, title, description, starts_at, duration_min,
		                     editor_room_id, whiteboard_room_id, recurrence_rule, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7::uuid, '00000000-0000-0000-0000-000000000000'),
		         NULLIF($8::uuid, '00000000-0000-0000-0000-000000000000'), $9, $10)
		 RETURNING id, created_at`,
		sharedpg.UUID(e.ID), sharedpg.UUID(e.CircleID), e.Title, e.Description,
		pgtype.Timestamptz{Time: e.StartsAt, Valid: !e.StartsAt.IsZero()},
		e.DurationMin, editorRoom, whiteboardRoom, string(e.Recurrence),
		sharedpg.UUID(e.CreatedBy),
	).Scan(&id, &createdAt)
	if err != nil {
		return domain.Event{}, fmt.Errorf("events.Events.Create: %w", err)
	}
	out := e
	out.ID = sharedpg.UUIDFrom(id)
	out.CreatedAt = createdAt
	return out, nil
}

func (r *Events) Get(ctx context.Context, id uuid.UUID) (domain.EventWithCircleName, error) {
	var (
		rowID          pgtype.UUID
		circleID       pgtype.UUID
		title          string
		description    string
		startsAt       time.Time
		durationMin    int
		editorRoom     pgtype.UUID
		whiteboardRoom pgtype.UUID
		recurrence     string
		createdBy      pgtype.UUID
		createdAt      time.Time
		circleName     string
	)
	err := r.pool.QueryRow(ctx,
		`SELECT e.id, e.circle_id, e.title, e.description, e.starts_at, e.duration_min,
		        e.editor_room_id, e.whiteboard_room_id, e.recurrence_rule,
		        e.created_by, e.created_at, COALESCE(c.name, '')
		   FROM events e
		   LEFT JOIN circles c ON c.id = e.circle_id
		  WHERE e.id=$1`,
		sharedpg.UUID(id),
	).Scan(&rowID, &circleID, &title, &description, &startsAt, &durationMin,
		&editorRoom, &whiteboardRoom, &recurrence, &createdBy, &createdAt, &circleName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.EventWithCircleName{}, domain.ErrNotFound
		}
		return domain.EventWithCircleName{}, fmt.Errorf("events.Events.Get: %w", err)
	}
	ev := domain.Event{
		ID:          sharedpg.UUIDFrom(rowID),
		CircleID:    sharedpg.UUIDFrom(circleID),
		Title:       title,
		Description: description,
		StartsAt:    startsAt,
		DurationMin: durationMin,
		Recurrence:  domain.Recurrence(recurrence),
		CreatedBy:   sharedpg.UUIDFrom(createdBy),
		CreatedAt:   createdAt,
	}
	if editorRoom.Valid {
		v := sharedpg.UUIDFrom(editorRoom)
		ev.EditorRoomID = &v
	}
	if whiteboardRoom.Valid {
		v := sharedpg.UUIDFrom(whiteboardRoom)
		ev.WhiteboardRoomID = &v
	}
	return domain.EventWithCircleName{Event: ev, CircleName: circleName}, nil
}

func (r *Events) ListUpcomingByMember(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]domain.EventWithCircleName, error) {
	// User-visible events =
	//   (events of circles where user is a member)
	// ∪ (events the user explicitly participates in)
	// ∪ (events the user authored — covers the case where the creator
	//    isn't yet a circle_member but obviously should see their own
	//    event in the list).
	// Without the participants/created_by branch a freshly-created event
	// could disappear from the creator's list and the response would
	// look like "{}", which is exactly what users reported.
	rows, err := r.pool.Query(ctx,
		`SELECT DISTINCT e.id, e.circle_id, e.title, e.description, e.starts_at,
		        e.duration_min, e.editor_room_id, e.whiteboard_room_id,
		        e.recurrence_rule, e.created_by, e.created_at, COALESCE(c.name, '')
		   FROM events e
		   LEFT JOIN circles c ON c.id = e.circle_id
		   LEFT JOIN circle_members m
		     ON m.circle_id = e.circle_id AND m.user_id = $1
		   LEFT JOIN event_participants p
		     ON p.event_id = e.id AND p.user_id = $1
		  WHERE (m.user_id IS NOT NULL OR p.user_id IS NOT NULL OR e.created_by = $1)
		    AND e.starts_at >= $2
		    AND e.starts_at <= $3
		  ORDER BY e.starts_at ASC
		  LIMIT 200`,
		sharedpg.UUID(userID),
		pgtype.Timestamptz{Time: from, Valid: true},
		pgtype.Timestamptz{Time: to, Valid: true},
	)
	if err != nil {
		return nil, fmt.Errorf("events.Events.ListUpcomingByMember: %w", err)
	}
	defer rows.Close()
	var out []domain.EventWithCircleName
	for rows.Next() {
		var (
			rowID          pgtype.UUID
			circleID       pgtype.UUID
			title          string
			description    string
			startsAt       time.Time
			durationMin    int
			editorRoom     pgtype.UUID
			whiteboardRoom pgtype.UUID
			recurrence     string
			createdBy      pgtype.UUID
			createdAt      time.Time
			circleName     string
		)
		if err := rows.Scan(&rowID, &circleID, &title, &description, &startsAt, &durationMin,
			&editorRoom, &whiteboardRoom, &recurrence, &createdBy, &createdAt, &circleName); err != nil {
			return nil, fmt.Errorf("events.Events.ListUpcomingByMember scan: %w", err)
		}
		ev := domain.Event{
			ID:          sharedpg.UUIDFrom(rowID),
			CircleID:    sharedpg.UUIDFrom(circleID),
			Title:       title,
			Description: description,
			StartsAt:    startsAt,
			DurationMin: durationMin,
			Recurrence:  domain.Recurrence(recurrence),
			CreatedBy:   sharedpg.UUIDFrom(createdBy),
			CreatedAt:   createdAt,
		}
		if editorRoom.Valid {
			v := sharedpg.UUIDFrom(editorRoom)
			ev.EditorRoomID = &v
		}
		if whiteboardRoom.Valid {
			v := sharedpg.UUIDFrom(whiteboardRoom)
			ev.WhiteboardRoomID = &v
		}
		out = append(out, domain.EventWithCircleName{Event: ev, CircleName: circleName})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("events.Events.ListUpcomingByMember rows: %w", err)
	}
	return out, nil
}

func (r *Events) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM events WHERE id=$1`, sharedpg.UUID(id))
	if err != nil {
		return fmt.Errorf("events.Events.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

type Participants struct {
	pool *pgxpool.Pool
}

func NewParticipants(pool *pgxpool.Pool) *Participants { return &Participants{pool: pool} }

func (r *Participants) Add(ctx context.Context, in domain.Participant) (domain.Participant, error) {
	var joinedAt time.Time
	err := r.pool.QueryRow(ctx,
		`INSERT INTO event_participants (event_id, user_id, joined_at)
		 VALUES ($1, $2, COALESCE(NULLIF($3, '0001-01-01 00:00:00+00'::timestamptz), now()))
		 ON CONFLICT (event_id, user_id) DO UPDATE SET joined_at = event_participants.joined_at
		 RETURNING joined_at`,
		sharedpg.UUID(in.EventID), sharedpg.UUID(in.UserID),
		pgtype.Timestamptz{Time: in.JoinedAt, Valid: !in.JoinedAt.IsZero()},
	).Scan(&joinedAt)
	if err != nil {
		return domain.Participant{}, fmt.Errorf("events.Participants.Add: %w", err)
	}
	out := in
	out.JoinedAt = joinedAt
	return out, nil
}

func (r *Participants) Remove(ctx context.Context, eventID, userID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM event_participants WHERE event_id=$1 AND user_id=$2`,
		sharedpg.UUID(eventID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("events.Participants.Remove: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *Participants) List(ctx context.Context, eventID uuid.UUID) ([]domain.ParticipantWithUsername, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT p.event_id, p.user_id, p.joined_at, COALESCE(u.username,'')
		   FROM event_participants p
		   LEFT JOIN users u ON u.id = p.user_id
		  WHERE p.event_id=$1
		  ORDER BY p.joined_at ASC`,
		sharedpg.UUID(eventID),
	)
	if err != nil {
		return nil, fmt.Errorf("events.Participants.List: %w", err)
	}
	defer rows.Close()
	var out []domain.ParticipantWithUsername
	for rows.Next() {
		var (
			eID      pgtype.UUID
			uID      pgtype.UUID
			joinedAt time.Time
			username string
		)
		if err := rows.Scan(&eID, &uID, &joinedAt, &username); err != nil {
			return nil, fmt.Errorf("events.Participants.List scan: %w", err)
		}
		out = append(out, domain.ParticipantWithUsername{
			Participant: domain.Participant{
				EventID:  sharedpg.UUIDFrom(eID),
				UserID:   sharedpg.UUIDFrom(uID),
				JoinedAt: joinedAt,
			},
			Username: username,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("events.Participants.List rows: %w", err)
	}
	return out, nil
}

var (
	_ domain.EventRepo       = (*Events)(nil)
	_ domain.ParticipantRepo = (*Participants)(nil)
)
