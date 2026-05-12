// cue_session_repo.go — pgx adapter over cue_sessions (migration 00087).
//
// Stages храним в JSONB; Postgres сам валидирует структуру. Persona /
// company / ai_summary / raw_transcript — nullable TEXT, в Go конвертим
// "" ⇄ NULL через nullableText helper.
package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InterviewSessions — pgx-backed InterviewSessionRepo.
type InterviewSessions struct{ pool *pgxpool.Pool }

// NewInterviewSessions wires the adapter.
func NewInterviewSessions(pool *pgxpool.Pool) *InterviewSessions {
	return &InterviewSessions{pool: pool}
}

// Insert persists one row. CompletedAt zero → DEFAULT now().
func (r *InterviewSessions) Insert(ctx context.Context, in domain.InterviewSession) (domain.InterviewSession, error) {
	stagesJSON, err := json.Marshal(in.Stages)
	if err != nil {
		return domain.InterviewSession{}, fmt.Errorf("intelligence.InterviewSessions.Insert marshal stages: %w", err)
	}
	if len(stagesJSON) == 0 {
		stagesJSON = []byte(`[]`)
	}

	var completedAt any
	if !in.CompletedAt.IsZero() {
		completedAt = in.CompletedAt
	}

	var (
		id          pgtype.UUID
		completedAtOut time.Time
	)
	if err := r.pool.QueryRow(ctx, `
		INSERT INTO cue_sessions
		    (user_id, company, persona, stages, ai_summary,
		     raw_transcript, completed_at)
		VALUES ($1, $2, $3, $4::jsonb, $5, $6, COALESCE($7::timestamptz, now()))
		RETURNING id, completed_at`,
		sharedpg.UUID(in.UserID),
		nullableText(in.Company),
		nullableText(in.Persona),
		string(stagesJSON),
		nullableText(in.AISummary),
		nullableText(in.RawTranscript),
		completedAt,
	).Scan(&id, &completedAtOut); err != nil {
		return domain.InterviewSession{}, fmt.Errorf("intelligence.InterviewSessions.Insert: %w", err)
	}

	out := in
	out.ID = sharedpg.UUIDFrom(id)
	out.CompletedAt = completedAtOut
	if out.Stages == nil {
		out.Stages = []domain.InterviewStage{}
	}
	return out, nil
}

// ListByUser returns paginated sessions newest-first plus total row count.
func (r *InterviewSessions) ListByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]domain.InterviewSession, int, error) {
	var total int
	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM cue_sessions WHERE user_id = $1`,
		sharedpg.UUID(userID),
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("intelligence.InterviewSessions.ListByUser count: %w", err)
	}
	if total == 0 {
		return nil, 0, nil
	}

	rows, err := r.pool.Query(ctx, `
		SELECT id,
		       COALESCE(company,        ''),
		       COALESCE(persona,        ''),
		       stages,
		       COALESCE(ai_summary,     ''),
		       COALESCE(raw_transcript, ''),
		       completed_at
		  FROM cue_sessions
		 WHERE user_id = $1
		 ORDER BY completed_at DESC
		 LIMIT $2 OFFSET $3`,
		sharedpg.UUID(userID), limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("intelligence.InterviewSessions.ListByUser query: %w", err)
	}
	defer rows.Close()

	out := make([]domain.InterviewSession, 0, limit)
	for rows.Next() {
		var (
			id                                pgtype.UUID
			company, persona                  string
			stagesRaw                         []byte
			aiSummary, rawTranscript          string
			completedAt                       time.Time
		)
		if err := rows.Scan(&id, &company, &persona, &stagesRaw,
			&aiSummary, &rawTranscript, &completedAt); err != nil {
			return nil, 0, fmt.Errorf("intelligence.InterviewSessions.ListByUser scan: %w", err)
		}
		stages := []domain.InterviewStage{}
		if len(stagesRaw) > 0 {
			if err := json.Unmarshal(stagesRaw, &stages); err != nil {
				return nil, 0, fmt.Errorf("intelligence.InterviewSessions.ListByUser unmarshal: %w", err)
			}
		}
		out = append(out, domain.InterviewSession{
			ID:            sharedpg.UUIDFrom(id),
			UserID:        userID,
			Company:       company,
			Persona:       persona,
			Stages:        stages,
			AISummary:     aiSummary,
			RawTranscript: rawTranscript,
			CompletedAt:   completedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("intelligence.InterviewSessions.ListByUser rows: %w", err)
	}
	return out, total, nil
}

// Compile-time guard.
var _ domain.InterviewSessionRepo = (*InterviewSessions)(nil)
