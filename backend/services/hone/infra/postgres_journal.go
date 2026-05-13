// Resistance journal repository (Phase K Wave 15) — persists resistance_log.
package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/hone/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Journal implements domain.JournalRepo.
type Journal struct {
	pool *pgxpool.Pool
}

// NewJournal wraps a pool.
func NewJournal(pool *pgxpool.Pool) *Journal { return &Journal{pool: pool} }

// Insert persist'ит запись. focus_session_id / task_id NULL-safe: app
// передаёт указатель или nil.
func (j *Journal) Insert(ctx context.Context, e domain.JournalEntry) (domain.JournalEntry, error) {
	var (
		id  pgtype.UUID
		at  time.Time
	)
	var focusUUID *pgtype.UUID
	if e.FocusSessionID != nil {
		v := sharedpg.UUID(*e.FocusSessionID)
		focusUUID = &v
	}
	var taskUUID *pgtype.UUID
	if e.TaskID != nil {
		v := sharedpg.UUID(*e.TaskID)
		taskUUID = &v
	}
	err := j.pool.QueryRow(ctx,
		`INSERT INTO resistance_log (user_id, text, focus_session_id, task_id, logged_at)
		 VALUES ($1, $2, $3, $4, COALESCE($5, now()))
		 RETURNING id, logged_at`,
		sharedpg.UUID(e.UserID), e.Text, focusUUID, taskUUID, nullableTime(e.LoggedAt),
	).Scan(&id, &at)
	if err != nil {
		return domain.JournalEntry{}, fmt.Errorf("hone.Journal.Insert: %w", err)
	}
	e.ID = sharedpg.UUIDFrom(id)
	e.LoggedAt = at
	return e, nil
}

// ListRecent returns entries за `lookback`, ORDER BY logged_at DESC.
func (j *Journal) ListRecent(ctx context.Context, userID uuid.UUID, lookback time.Duration) ([]domain.JournalEntry, error) {
	if lookback <= 0 {
		lookback = 7 * 24 * time.Hour
	}
	since := time.Now().UTC().Add(-lookback)
	rows, err := j.pool.Query(ctx,
		`SELECT id, text, focus_session_id, task_id, logged_at
		   FROM resistance_log
		  WHERE user_id=$1 AND logged_at >= $2
		  ORDER BY logged_at DESC
		  LIMIT 500`,
		sharedpg.UUID(userID), since,
	)
	if err != nil {
		return nil, fmt.Errorf("hone.Journal.ListRecent: %w", err)
	}
	defer rows.Close()
	out := make([]domain.JournalEntry, 0, 32)
	for rows.Next() {
		var (
			id       pgtype.UUID
			text     string
			focus    pgtype.UUID
			task     pgtype.UUID
			loggedAt time.Time
		)
		if err := rows.Scan(&id, &text, &focus, &task, &loggedAt); err != nil {
			return nil, fmt.Errorf("hone.Journal.ListRecent: scan: %w", err)
		}
		e := domain.JournalEntry{
			ID:       sharedpg.UUIDFrom(id),
			UserID:   userID,
			Text:     text,
			LoggedAt: loggedAt,
		}
		if focus.Valid {
			v := sharedpg.UUIDFrom(focus)
			e.FocusSessionID = &v
		}
		if task.Valid {
			v := sharedpg.UUIDFrom(task)
			e.TaskID = &v
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Journal.ListRecent: rows: %w", err)
	}
	return out, nil
}

// nullableTime — passes time.Time or nil to pgx so the INSERT
// COALESCE(now(), $5) falls back to server clock when the caller has not
// pre-set LoggedAt.
func nullableTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}
