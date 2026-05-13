// focus_reflections_postgres.go — pgx adapter over focus_reflections
// (migration 00103).
//
// Insert использует ON CONFLICT (user_id, session_id) DO UPDATE так что
// idempotent replay из Hone outbox безопасен — повторная попытка возвращает
// existing row id вместо ошибки. Notes/grade конкретного retry могут отличаться
// (юзер мог дописать после offline-обрыва) — берём latest write.
package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FocusReflectionsPostgres — pgx-backed FocusReflectionRepo.
type FocusReflectionsPostgres struct{ pool *pgxpool.Pool }

// NewFocusReflectionsPostgres wires the adapter.
func NewFocusReflectionsPostgres(pool *pgxpool.Pool) *FocusReflectionsPostgres {
	return &FocusReflectionsPostgres{pool: pool}
}

// Insert persists one row idempotently. Returns the persisted row including
// the server-assigned id/created_at. ON CONFLICT — UPDATE so latest replay
// wins (юзер мог дополнить notes после offline retry).
func (r *FocusReflectionsPostgres) Insert(ctx context.Context, in domain.FocusReflection) (domain.FocusReflection, error) {
	var gradeArg any
	if in.Grade != nil {
		gradeArg = int16(*in.Grade)
	}
	var (
		id        pgtype.UUID
		userID    pgtype.UUID
		gradeOut  pgtype.Int2
		notesOut  string
		taskOut   string
		modeOut   string
		dur       int32
		startedAt time.Time
		endedAt   time.Time
		createdAt time.Time
	)
	err := r.pool.QueryRow(ctx, `
		INSERT INTO focus_reflections
		    (user_id, session_id, focus_mode, duration_seconds, grade,
		     notes, task_pinned, started_at, ended_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (user_id, session_id) DO UPDATE
		    SET grade            = EXCLUDED.grade,
		        notes            = EXCLUDED.notes,
		        task_pinned      = EXCLUDED.task_pinned,
		        duration_seconds = EXCLUDED.duration_seconds,
		        ended_at         = EXCLUDED.ended_at
		RETURNING id, user_id, focus_mode, duration_seconds, grade, notes,
		          task_pinned, started_at, ended_at, created_at`,
		sharedpg.UUID(in.UserID), in.SessionID, in.FocusMode,
		int32(in.DurationSeconds), gradeArg, in.Notes, in.TaskPinned,
		in.StartedAt, in.EndedAt,
	).Scan(&id, &userID, &modeOut, &dur, &gradeOut, &notesOut, &taskOut,
		&startedAt, &endedAt, &createdAt)
	if err != nil {
		return domain.FocusReflection{}, fmt.Errorf("intelligence.FocusReflectionsPostgres.Insert: %w", err)
	}
	out := domain.FocusReflection{
		ID:              sharedpg.UUIDFrom(id),
		UserID:          sharedpg.UUIDFrom(userID),
		SessionID:       in.SessionID,
		FocusMode:       modeOut,
		DurationSeconds: int(dur),
		Notes:           notesOut,
		TaskPinned:      taskOut,
		StartedAt:       startedAt,
		EndedAt:         endedAt,
		CreatedAt:       createdAt,
	}
	if gradeOut.Valid {
		g := int(gradeOut.Int16)
		out.Grade = &g
	}
	return out, nil
}

// ListRecent returns reflections newest-first within windowDays.
func (r *FocusReflectionsPostgres) ListRecent(ctx context.Context, userID uuid.UUID, windowDays int) ([]domain.FocusReflection, error) {
	if windowDays <= 0 {
		windowDays = 30
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, focus_mode, duration_seconds, grade, COALESCE(notes, ''),
		       COALESCE(task_pinned, ''), session_id, started_at, ended_at,
		       created_at
		  FROM focus_reflections
		 WHERE user_id = $1
		   AND ended_at >= now() - ($2 || ' days')::interval
		 ORDER BY ended_at DESC
		 LIMIT 1000`,
		sharedpg.UUID(userID), fmt.Sprintf("%d", windowDays),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.FocusReflectionsPostgres.ListRecent: %w", err)
	}
	defer rows.Close()

	out := make([]domain.FocusReflection, 0, 64)
	for rows.Next() {
		var (
			id        pgtype.UUID
			mode      string
			dur       int32
			gradeOut  pgtype.Int2
			notes     string
			task      string
			sessionID string
			startedAt time.Time
			endedAt   time.Time
			createdAt time.Time
		)
		if err := rows.Scan(&id, &mode, &dur, &gradeOut, &notes, &task,
			&sessionID, &startedAt, &endedAt, &createdAt); err != nil {
			return nil, fmt.Errorf("intelligence.FocusReflectionsPostgres.ListRecent scan: %w", err)
		}
		item := domain.FocusReflection{
			ID:              sharedpg.UUIDFrom(id),
			UserID:          userID,
			SessionID:       sessionID,
			FocusMode:       mode,
			DurationSeconds: int(dur),
			Notes:           notes,
			TaskPinned:      task,
			StartedAt:       startedAt,
			EndedAt:         endedAt,
			CreatedAt:       createdAt,
		}
		if gradeOut.Valid {
			g := int(gradeOut.Int16)
			item.Grade = &g
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.FocusReflectionsPostgres.ListRecent rows: %w", err)
	}
	return out, nil
}

// Compile-time guard.
var _ domain.FocusReflectionRepo = (*FocusReflectionsPostgres)(nil)
