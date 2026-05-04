package infra

import (
	"context"
	"fmt"

	"druz9/tutor/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// CreateSharedMaterial implements domain.SharedMaterialRepo.
func (p *Postgres) CreateSharedMaterial(ctx context.Context, m domain.SharedMaterial) (domain.SharedMaterial, error) {
	const q = `
		INSERT INTO tutor_shared_materials (tutor_id, title, source_url, body_md, student_count)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at`
	row := p.pool.QueryRow(ctx, q,
		pgtype.UUID{Bytes: m.TutorID, Valid: true},
		m.Title, m.SourceURL, m.BodyMD, m.StudentCount,
	)
	var (
		id        pgtype.UUID
		createdAt pgtype.Timestamptz
	)
	if err := row.Scan(&id, &createdAt); err != nil {
		return domain.SharedMaterial{}, fmt.Errorf("tutor.CreateSharedMaterial: %w", err)
	}
	m.ID = uuidFrom(id)
	if createdAt.Valid {
		m.CreatedAt = createdAt.Time
	}
	return m, nil
}

// ListSharedMaterialsByTutor implements domain.SharedMaterialRepo.
func (p *Postgres) ListSharedMaterialsByTutor(ctx context.Context, tutorID uuid.UUID, limit int) ([]domain.SharedMaterial, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := p.pool.Query(ctx, `
		SELECT id, tutor_id, title, source_url, body_md, student_count, created_at
		FROM tutor_shared_materials
		WHERE tutor_id = $1
		ORDER BY created_at DESC
		LIMIT $2`,
		pgtype.UUID{Bytes: tutorID, Valid: true}, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListSharedMaterialsByTutor: %w", err)
	}
	defer rows.Close()
	out := make([]domain.SharedMaterial, 0, limit)
	for rows.Next() {
		var (
			id, tID   pgtype.UUID
			title     string
			url       string
			body      string
			count     int
			createdAt pgtype.Timestamptz
		)
		if err := rows.Scan(&id, &tID, &title, &url, &body, &count, &createdAt); err != nil {
			return nil, fmt.Errorf("tutor.ListSharedMaterialsByTutor scan: %w", err)
		}
		m := domain.SharedMaterial{
			ID: uuidFrom(id), TutorID: uuidFrom(tID),
			Title: title, SourceURL: url, BodyMD: body, StudentCount: count,
		}
		if createdAt.Valid {
			m.CreatedAt = createdAt.Time
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
