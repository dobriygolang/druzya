// Focus repository — moved out of postgres.go (Wave 10 split).
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/hone/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Focus implements domain.FocusRepo.
type Focus struct {
	pool *pgxpool.Pool
}

// NewFocus wraps a pool.
func NewFocus(pool *pgxpool.Pool) *Focus { return &Focus{pool: pool} }

// Create inserts a started session.
func (f *Focus) Create(ctx context.Context, s domain.FocusSession) (domain.FocusSession, error) {
	var (
		id        pgtype.UUID
		createdAt time.Time
	)
	var planID pgtype.UUID
	if s.PlanID != nil {
		planID = sharedpg.UUID(*s.PlanID)
	}
	err := f.pool.QueryRow(ctx,
		`INSERT INTO hone_focus_sessions (user_id, plan_id, plan_item_id, pinned_title, mode, started_at)
		 VALUES ($1, NULLIF($2, '00000000-0000-0000-0000-000000000000'::uuid), $3, $4, $5, $6)
		 RETURNING id, created_at`,
		sharedpg.UUID(s.UserID), planID, s.PlanItemID, s.PinnedTitle, string(s.Mode), s.StartedAt,
	).Scan(&id, &createdAt)
	if err != nil {
		return domain.FocusSession{}, fmt.Errorf("hone.Focus.Create: %w", err)
	}
	s.ID = sharedpg.UUIDFrom(id)
	s.CreatedAt = createdAt
	return s, nil
}

// End closes a session and returns the hydrated row.
func (f *Focus) End(ctx context.Context, userID, sessionID uuid.UUID, endedAt time.Time, pomodoros, secondsFocused int) (domain.FocusSession, error) {
	var (
		planID      pgtype.UUID
		planItemID  string
		pinnedTitle string
		mode        string
		startedAt   time.Time
		createdAt   time.Time
	)
	err := f.pool.QueryRow(ctx,
		`UPDATE hone_focus_sessions
		    SET ended_at=$3, pomodoros_completed=$4, seconds_focused=$5
		  WHERE id=$1 AND user_id=$2 AND ended_at IS NULL
		  RETURNING plan_id, plan_item_id, pinned_title, mode, started_at, created_at`,
		sharedpg.UUID(sessionID), sharedpg.UUID(userID), endedAt, int32(pomodoros), int32(secondsFocused),
	).Scan(&planID, &planItemID, &pinnedTitle, &mode, &startedAt, &createdAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.FocusSession{}, domain.ErrNotFound
		}
		return domain.FocusSession{}, fmt.Errorf("hone.Focus.End: %w", err)
	}
	out := domain.FocusSession{
		ID:                 sessionID,
		UserID:             userID,
		PlanItemID:         planItemID,
		PinnedTitle:        pinnedTitle,
		Mode:               domain.FocusMode(mode),
		StartedAt:          startedAt,
		EndedAt:            &endedAt,
		PomodorosCompleted: pomodoros,
		SecondsFocused:     secondsFocused,
		CreatedAt:          createdAt,
	}
	if planID.Valid {
		id := sharedpg.UUIDFrom(planID)
		out.PlanID = &id
	}
	return out, nil
}

// Get fetches one session by id + owner. ErrNotFound when missing.
// Mirrors End()'s SELECT shape so callers always see the same hydrated
// projection regardless of whether the session is open or closed.
func (f *Focus) Get(ctx context.Context, userID, sessionID uuid.UUID) (domain.FocusSession, error) {
	var (
		planID         pgtype.UUID
		planItemID     string
		pinnedTitle    string
		mode           string
		startedAt      time.Time
		endedAt        pgtype.Timestamptz
		pomodoros      int32
		secondsFocused int32
		createdAt      time.Time
	)
	err := f.pool.QueryRow(ctx,
		`SELECT plan_id, plan_item_id, pinned_title, mode, started_at,
		        ended_at, pomodoros_completed, seconds_focused, created_at
		   FROM hone_focus_sessions
		  WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(sessionID), sharedpg.UUID(userID),
	).Scan(&planID, &planItemID, &pinnedTitle, &mode, &startedAt,
		&endedAt, &pomodoros, &secondsFocused, &createdAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.FocusSession{}, domain.ErrNotFound
		}
		return domain.FocusSession{}, fmt.Errorf("hone.Focus.Get: %w", err)
	}
	out := domain.FocusSession{
		ID:                 sessionID,
		UserID:             userID,
		PlanItemID:         planItemID,
		PinnedTitle:        pinnedTitle,
		Mode:               domain.FocusMode(mode),
		StartedAt:          startedAt,
		PomodorosCompleted: int(pomodoros),
		SecondsFocused:     int(secondsFocused),
		CreatedAt:          createdAt,
	}
	if planID.Valid {
		id := sharedpg.UUIDFrom(planID)
		out.PlanID = &id
	}
	if endedAt.Valid {
		t := endedAt.Time
		out.EndedAt = &t
	}
	return out, nil
}
