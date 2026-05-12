// reading_path_repo.go — Stream D (2026-05-12). pgx-backed
// domain.ReadingPathRepo over tutor_reading_paths (migration 00093).
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// CreateReadingPath implements domain.ReadingPathRepo.
func (p *Postgres) CreateReadingPath(ctx context.Context, in domain.ReadingPath) (domain.ReadingPath, error) {
	const q = `
		INSERT INTO tutor_reading_paths (tutor_id, name, description, atlas_node_keys, resource_ids)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, assigned_count, archived_at, created_at, updated_at`
	row := p.pool.QueryRow(ctx, q,
		pgUUID(in.TutorID),
		in.Name,
		in.Description,
		in.AtlasNodeKeys,
		uuidArrToPg(in.ResourceIDs),
	)
	var (
		id            pgtype.UUID
		assignedCount int32
		archivedAt    pgtype.Timestamptz
		createdAt     pgtype.Timestamptz
		updatedAt     pgtype.Timestamptz
	)
	if err := row.Scan(&id, &assignedCount, &archivedAt, &createdAt, &updatedAt); err != nil {
		return domain.ReadingPath{}, fmt.Errorf("tutor.CreateReadingPath: %w", err)
	}
	in.ID = uuidFrom(id)
	in.AssignedCount = int(assignedCount)
	in.ArchivedAt = nullableTime(archivedAt)
	if createdAt.Valid {
		in.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		in.UpdatedAt = updatedAt.Time
	}
	return in, nil
}

// UpdateReadingPath overwrites name/description/keys/ids in place.
// Scoped by tutor_id — that's the per-row auth gate.
func (p *Postgres) UpdateReadingPath(ctx context.Context, in domain.ReadingPath) (domain.ReadingPath, error) {
	const q = `
		UPDATE tutor_reading_paths
		SET name = $3,
		    description = $4,
		    atlas_node_keys = $5,
		    resource_ids = $6,
		    updated_at = now()
		WHERE id = $1 AND tutor_id = $2 AND archived_at IS NULL
		RETURNING id, tutor_id, name, description, atlas_node_keys, resource_ids,
		          assigned_count, archived_at, created_at, updated_at`
	row := p.pool.QueryRow(ctx, q,
		pgUUID(in.ID), pgUUID(in.TutorID),
		in.Name, in.Description,
		in.AtlasNodeKeys, uuidArrToPg(in.ResourceIDs),
	)
	out, err := scanReadingPath(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ReadingPath{}, fmt.Errorf("tutor.UpdateReadingPath: %w", domain.ErrNotFound)
		}
		return domain.ReadingPath{}, fmt.Errorf("tutor.UpdateReadingPath: %w", err)
	}
	return out, nil
}

// ArchiveReadingPath stamps archived_at. Idempotent — re-archiving an
// already-archived row returns nil silently (RowsAffected == 0 is not
// an error here because the caller's intent ("be archived") is satisfied).
func (p *Postgres) ArchiveReadingPath(ctx context.Context, tutorID, pathID uuid.UUID, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE tutor_reading_paths
		SET archived_at = $1, updated_at = $1
		WHERE id = $2 AND tutor_id = $3 AND archived_at IS NULL`,
		pgtype.Timestamptz{Time: now, Valid: true},
		pgUUID(pathID), pgUUID(tutorID),
	)
	if err != nil {
		return fmt.Errorf("tutor.ArchiveReadingPath: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Distinguish «not yours / doesn't exist» (ErrNotFound) from
		// «already archived» (no-op) by a follow-up existence check.
		var exists bool
		row := p.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM tutor_reading_paths WHERE id = $1 AND tutor_id = $2)`,
			pgUUID(pathID), pgUUID(tutorID),
		)
		if scanErr := row.Scan(&exists); scanErr != nil {
			return fmt.Errorf("tutor.ArchiveReadingPath: probe: %w", scanErr)
		}
		if !exists {
			return fmt.Errorf("tutor.ArchiveReadingPath: %w", domain.ErrNotFound)
		}
	}
	return nil
}

// ListReadingPathsByTutorPaged — keyset cursor on (created_at, id) DESC.
// Excludes archived rows.
func (p *Postgres) ListReadingPathsByTutorPaged(
	ctx context.Context, tutorID uuid.UUID, limit int, cursor string,
) ([]domain.ReadingPath, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	c, err := decodeCreatedAtCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListReadingPaths: %w", err)
	}
	args := []any{pgUUID(tutorID)}
	q := `
		SELECT id, tutor_id, name, description, atlas_node_keys, resource_ids,
		       assigned_count, archived_at, created_at, updated_at
		FROM tutor_reading_paths
		WHERE tutor_id = $1 AND archived_at IS NULL`
	if !c.CreatedAt.IsZero() {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("tutor.ListReadingPaths: cursor id: %w", parseErr)
		}
		args = append(args, c.CreatedAt, pgUUID(cid))
		q += fmt.Sprintf(` AND (created_at, id) < ($%d, $%d)`, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	q += fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT $%d`, len(args))

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("tutor.ListReadingPaths: %w", err)
	}
	defer rows.Close()
	out := make([]domain.ReadingPath, 0, limit)
	for rows.Next() {
		rp, scanErr := scanReadingPath(rows)
		if scanErr != nil {
			return nil, "", fmt.Errorf("tutor.ListReadingPaths scan: %w", scanErr)
		}
		out = append(out, rp)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("tutor.ListReadingPaths iterate: %w", err)
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

// ── helpers ───────────────────────────────────────────────────────────

func scanReadingPath(s rowScanner) (domain.ReadingPath, error) {
	var (
		id, tutorID    pgtype.UUID
		name           string
		description    string
		atlasNodeKeys  []string
		resourceIDs    []pgtype.UUID
		assignedCount  int32
		archivedAt     pgtype.Timestamptz
		createdAt      pgtype.Timestamptz
		updatedAt      pgtype.Timestamptz
	)
	if err := s.Scan(&id, &tutorID, &name, &description, &atlasNodeKeys,
		&resourceIDs, &assignedCount, &archivedAt, &createdAt, &updatedAt); err != nil {
		return domain.ReadingPath{}, err
	}
	out := domain.ReadingPath{
		ID:            uuidFrom(id),
		TutorID:       uuidFrom(tutorID),
		Name:          name,
		Description:   description,
		AtlasNodeKeys: atlasNodeKeys,
		ResourceIDs:   pgArrToUUIDs(resourceIDs),
		AssignedCount: int(assignedCount),
		ArchivedAt:    nullableTime(archivedAt),
	}
	if createdAt.Valid {
		out.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		out.UpdatedAt = updatedAt.Time
	}
	return out, nil
}

// uuidArrToPg converts a slice of domain UUIDs to the pgtype slice that
// pgx will marshal as Postgres uuid[]. Nil slice becomes the empty array
// so the DEFAULT '{}' contract is preserved.
func uuidArrToPg(in []uuid.UUID) []pgtype.UUID {
	if len(in) == 0 {
		return []pgtype.UUID{}
	}
	out := make([]pgtype.UUID, len(in))
	for i, u := range in {
		out[i] = pgUUID(u)
	}
	return out
}

// pgArrToUUIDs is the symmetric inverse — used during scan.
func pgArrToUUIDs(in []pgtype.UUID) []uuid.UUID {
	if len(in) == 0 {
		return []uuid.UUID{}
	}
	out := make([]uuid.UUID, len(in))
	for i, p := range in {
		out[i] = uuidFrom(p)
	}
	return out
}
