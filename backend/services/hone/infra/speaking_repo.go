// speaking_repo.go — Phase J / H4 (P1) Speaking modality persistence.
// Hand-rolled pgx over speaking_exercises + speaking_sessions. Sibling
// of reading_repo.go / listening_repo.go.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/hone/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SpeakingExerciseRepoPG — Postgres impl of domain.SpeakingExerciseRepo.
// Reads the fixed catalog seeded in migration 00105. No writes — catalog
// is admin-only (re-seed by re-running migration).
type SpeakingExerciseRepoPG struct {
	pool *pgxpool.Pool
}

func NewSpeakingExerciseRepo(pool *pgxpool.Pool) *SpeakingExerciseRepoPG {
	return &SpeakingExerciseRepoPG{pool: pool}
}

// List returns exercises filtered by level; empty level = all rows.
// Order: level ASC, id ASC — deterministic для UI; tutoring level
// progression (B1 → B2 → C1) lines up naturally.
func (r *SpeakingExerciseRepoPG) List(ctx context.Context, level domain.SpeakingLevel) ([]domain.SpeakingExercise, error) {
	var rows pgx.Rows
	var err error
	if level == "" {
		const q = `
			SELECT id, level, topic, prompt, audio_url
			FROM speaking_exercises
			ORDER BY level ASC, id ASC`
		rows, err = r.pool.Query(ctx, q)
	} else {
		const q = `
			SELECT id, level, topic, prompt, audio_url
			FROM speaking_exercises
			WHERE level = $1
			ORDER BY id ASC`
		rows, err = r.pool.Query(ctx, q, string(level))
	}
	if err != nil {
		return nil, fmt.Errorf("hone.ListSpeakingExercises: %w", err)
	}
	defer rows.Close()
	out := make([]domain.SpeakingExercise, 0, 16)
	for rows.Next() {
		var ex domain.SpeakingExercise
		var lvl string
		if err := rows.Scan(&ex.ID, &lvl, &ex.Topic, &ex.Prompt, &ex.AudioURL); err != nil {
			return nil, fmt.Errorf("hone.ListSpeakingExercises: scan: %w", err)
		}
		ex.Level = domain.SpeakingLevel(lvl)
		out = append(out, ex)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.ListSpeakingExercises: rows: %w", err)
	}
	return out, nil
}

// Get one exercise by id. Returns ErrNotFound when absent so the
// use-case can map to 404.
func (r *SpeakingExerciseRepoPG) Get(ctx context.Context, id string) (domain.SpeakingExercise, error) {
	const q = `
		SELECT id, level, topic, prompt, audio_url
		FROM speaking_exercises
		WHERE id = $1`
	var ex domain.SpeakingExercise
	var lvl string
	err := r.pool.QueryRow(ctx, q, id).Scan(&ex.ID, &lvl, &ex.Topic, &ex.Prompt, &ex.AudioURL)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.SpeakingExercise{}, fmt.Errorf("hone.GetSpeakingExercise: %w", domain.ErrNotFound)
		}
		return domain.SpeakingExercise{}, fmt.Errorf("hone.GetSpeakingExercise: %w", err)
	}
	ex.Level = domain.SpeakingLevel(lvl)
	return ex, nil
}

// SpeakingSessionRepoPG — Postgres impl of domain.SpeakingSessionRepo.
type SpeakingSessionRepoPG struct {
	pool *pgxpool.Pool
}

func NewSpeakingSessionRepo(pool *pgxpool.Pool) *SpeakingSessionRepoPG {
	return &SpeakingSessionRepoPG{pool: pool}
}

// Insert is idempotent on (user_id, client_session_id) via ON CONFLICT.
// On conflict we return the existing row — UI replay сценарий доходит до
// той же session UUID. RETURNING на ON CONFLICT DO NOTHING returns 0 rows
// when conflict fires, so we fall back to a SELECT в случае пустоты.
func (r *SpeakingSessionRepoPG) Insert(ctx context.Context, s domain.SpeakingSession) (domain.SpeakingSession, error) {
	if s.UserID == uuid.Nil {
		return domain.SpeakingSession{}, fmt.Errorf("hone.InsertSpeakingSession: user_id required")
	}
	if s.ClientSessionID == "" {
		return domain.SpeakingSession{}, fmt.Errorf("hone.InsertSpeakingSession: client_session_id required")
	}
	const insertQ = `
		INSERT INTO speaking_sessions (
			user_id, client_session_id, exercise_id, prompt,
			user_transcript, pronunciation_score, fluency_score,
			coach_feedback, duration_ms
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (user_id, client_session_id) DO NOTHING
		RETURNING id, created_at`
	var id pgtype.UUID
	var createdAt pgtype.Timestamptz
	err := r.pool.QueryRow(ctx, insertQ,
		sharedpg.UUID(s.UserID),
		s.ClientSessionID,
		s.ExerciseID,
		s.Prompt,
		s.UserTranscript,
		nullableInt16(s.PronunciationScore),
		nullableInt16(s.FluencyScore),
		s.CoachFeedback,
		s.DurationMS,
	).Scan(&id, &createdAt)
	if err == nil {
		s.ID = sharedpg.UUIDFrom(id)
		if createdAt.Valid {
			s.CreatedAt = createdAt.Time
		}
		return s, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return domain.SpeakingSession{}, fmt.Errorf("hone.InsertSpeakingSession: %w", err)
	}
	// Conflict — load the existing row so the caller gets the canonical
	// session UUID + first-success scores / feedback (not the second
	// replay's potentially different values).
	const selectQ = `
		SELECT id, exercise_id, prompt, user_transcript,
		       COALESCE(pronunciation_score, 0), COALESCE(fluency_score, 0),
		       coach_feedback, duration_ms, created_at
		FROM speaking_sessions
		WHERE user_id = $1 AND client_session_id = $2`
	var prScore, fluScore int16
	row := r.pool.QueryRow(ctx, selectQ, sharedpg.UUID(s.UserID), s.ClientSessionID)
	err = row.Scan(&id, &s.ExerciseID, &s.Prompt, &s.UserTranscript,
		&prScore, &fluScore, &s.CoachFeedback, &s.DurationMS, &createdAt)
	if err != nil {
		return domain.SpeakingSession{}, fmt.Errorf("hone.InsertSpeakingSession: load-existing: %w", err)
	}
	s.ID = sharedpg.UUIDFrom(id)
	s.PronunciationScore = int(prScore)
	s.FluencyScore = int(fluScore)
	if createdAt.Valid {
		s.CreatedAt = createdAt.Time
	}
	return s, nil
}

// ListByUser returns last N sessions, newest first. Used by history
// sparkline + history page. limit is pre-validated by the use-case.
func (r *SpeakingSessionRepoPG) ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]domain.SpeakingSession, error) {
	const q = `
		SELECT id, user_id, client_session_id, exercise_id, prompt,
		       user_transcript,
		       COALESCE(pronunciation_score, 0), COALESCE(fluency_score, 0),
		       coach_feedback, duration_ms, created_at
		FROM speaking_sessions
		WHERE user_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT $2`
	rows, err := r.pool.Query(ctx, q, sharedpg.UUID(userID), limit)
	if err != nil {
		return nil, fmt.Errorf("hone.ListSpeakingHistory: %w", err)
	}
	defer rows.Close()
	out := make([]domain.SpeakingSession, 0, limit)
	for rows.Next() {
		var s domain.SpeakingSession
		var id, uid pgtype.UUID
		var prScore, fluScore int16
		var createdAt pgtype.Timestamptz
		if err := rows.Scan(&id, &uid, &s.ClientSessionID, &s.ExerciseID, &s.Prompt,
			&s.UserTranscript, &prScore, &fluScore, &s.CoachFeedback, &s.DurationMS, &createdAt); err != nil {
			return nil, fmt.Errorf("hone.ListSpeakingHistory: scan: %w", err)
		}
		s.ID = sharedpg.UUIDFrom(id)
		s.UserID = sharedpg.UUIDFrom(uid)
		s.PronunciationScore = int(prScore)
		s.FluencyScore = int(fluScore)
		if createdAt.Valid {
			s.CreatedAt = createdAt.Time
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.ListSpeakingHistory: rows: %w", err)
	}
	return out, nil
}

// nullableInt16 — when the score is 0 we still pass it through as 0 (NOT
// NULL). LLM-unavailable path is the only flow that persists with 0
// scores; UI отображает их как «pending grade» if accompanying feedback
// is empty. CHECK constraint allows NULL OR 0..100, we never emit NULL
// from happy-path scoring.
func nullableInt16(v int) int16 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return int16(v)
}
