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

// ListSharedMaterialsByTutorPaged — keyset cursor over
// (created_at DESC, id DESC). cursor "" = first page.
func (p *Postgres) ListSharedMaterialsByTutorPaged(
	ctx context.Context, tutorID uuid.UUID, limit int, cursor string,
) ([]domain.SharedMaterial, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 30
	}
	c, err := decodeCreatedAtCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListSharedMaterialsByTutor: %w", err)
	}
	args := []any{pgtype.UUID{Bytes: tutorID, Valid: true}}
	q := `
		SELECT id, tutor_id, title, source_url, body_md, student_count, created_at
		FROM tutor_shared_materials
		WHERE tutor_id = $1`
	if !c.CreatedAt.IsZero() {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("tutor.ListSharedMaterialsByTutor: cursor id: %w", parseErr)
		}
		args = append(args, c.CreatedAt, pgtype.UUID{Bytes: cid, Valid: true})
		q += fmt.Sprintf(` AND (created_at, id) < ($%d, $%d)`, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	q += fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT $%d`, len(args))

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListSharedMaterialsByTutor: %w", err)
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
		if scanErr := rows.Scan(&id, &tID, &title, &url, &body, &count, &createdAt); scanErr != nil {
			return nil, "", fmt.Errorf("tutor.ListSharedMaterialsByTutor scan: %w", scanErr)
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
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("tutor.shared_reading_repo rows: %w", err)
	}
	var nextCursor string
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		nextCursor = encodeCreatedAtCursor(createdAtCursor{
			CreatedAt: last.CreatedAt,
			ID:        last.ID.String(),
		})
	}
	return out, nextCursor, nil
}
