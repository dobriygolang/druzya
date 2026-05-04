package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/tutor/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// GetSessionNotes implements domain.SessionNotesRepo.
//
// Read-or-empty: пустая строка — валидный «нет notes» сценарий. Если
// row не найден — возвращаем zero-value SessionNotes с переданными ID
// и empty body. Это упрощает handler (нет ветки для NotFound).
func (p *Postgres) GetSessionNotes(
	ctx context.Context, tutorID, studentID uuid.UUID,
) (domain.SessionNotes, error) {
	const q = `
		SELECT body_md, updated_at
		FROM tutor_session_notes
		WHERE tutor_id = $1 AND student_id = $2`
	row := p.pool.QueryRow(ctx, q,
		pgtype.UUID{Bytes: tutorID, Valid: true},
		pgtype.UUID{Bytes: studentID, Valid: true},
	)
	var (
		body      string
		updatedAt pgtype.Timestamptz
	)
	if err := row.Scan(&body, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.SessionNotes{TutorID: tutorID, StudentID: studentID}, nil
		}
		return domain.SessionNotes{}, fmt.Errorf("tutor.GetSessionNotes: %w", err)
	}
	return domain.SessionNotes{
		TutorID:   tutorID,
		StudentID: studentID,
		BodyMD:    body,
		UpdatedAt: updatedAt.Time,
	}, nil
}

// SaveSessionNotes upsert поверх PK (tutor_id, student_id). Empty body
// разрешён («тутор очистил блок» — оставляем row, чтобы updated_at
// сохранил последнюю модификацию).
func (p *Postgres) SaveSessionNotes(
	ctx context.Context, n domain.SessionNotes,
) (domain.SessionNotes, error) {
	const q = `
		INSERT INTO tutor_session_notes (tutor_id, student_id, body_md, updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (tutor_id, student_id) DO UPDATE
			SET body_md = EXCLUDED.body_md,
			    updated_at = now()
		RETURNING updated_at`
	row := p.pool.QueryRow(ctx, q,
		pgtype.UUID{Bytes: n.TutorID, Valid: true},
		pgtype.UUID{Bytes: n.StudentID, Valid: true},
		n.BodyMD,
	)
	var updatedAt pgtype.Timestamptz
	if err := row.Scan(&updatedAt); err != nil {
		return domain.SessionNotes{}, fmt.Errorf("tutor.SaveSessionNotes: %w", err)
	}
	n.UpdatedAt = updatedAt.Time
	return n, nil
}
