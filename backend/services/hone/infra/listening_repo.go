// listening_repo.go — Wave 6.1 of docs/feature/plan.md.
// Hand-rolled pgx over hone_listening_materials. Sibling of
// reading_repo.go (Wave 4); same per-feature struct pattern.
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

// ListeningRepoPG — Postgres impl of domain.ListeningRepo. Standalone
// struct (not folded into ReadingRepoPG) so the two sub-contexts can
// evolve their schemas independently.
type ListeningRepoPG struct {
	pool *pgxpool.Pool
}

// NewListeningRepo wraps a pgx pool.
func NewListeningRepo(pool *pgxpool.Pool) *ListeningRepoPG {
	return &ListeningRepoPG{pool: pool}
}

func (p *ListeningRepoPG) CreateMaterial(ctx context.Context, m domain.ListeningMaterial) (domain.ListeningMaterial, error) {
	const q = `
		INSERT INTO hone_listening_materials (user_id, title, audio_url, transcript_md)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at, updated_at`
	var id pgtype.UUID
	var createdAt, updatedAt pgtype.Timestamptz
	err := p.pool.QueryRow(ctx, q,
		sharedpg.UUID(m.UserID), m.Title, m.AudioURL, m.TranscriptMD,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.ListeningMaterial{}, fmt.Errorf("hone.CreateListeningMaterial: %w", err)
	}
	m.ID = sharedpg.UUIDFrom(id)
	if createdAt.Valid {
		m.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		m.UpdatedAt = updatedAt.Time
	}
	return m, nil
}

func (p *ListeningRepoPG) GetMaterial(ctx context.Context, userID, materialID uuid.UUID) (domain.ListeningMaterial, error) {
	const q = `
		SELECT id, user_id, title, audio_url, transcript_md, archived_at, created_at, updated_at
		FROM hone_listening_materials
		WHERE id = $1 AND user_id = $2`
	row := p.pool.QueryRow(ctx, q, sharedpg.UUID(materialID), sharedpg.UUID(userID))
	out, err := scanListeningMaterial(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ListeningMaterial{}, fmt.Errorf("hone.GetListeningMaterial: %w", domain.ErrNotFound)
		}
		return domain.ListeningMaterial{}, fmt.Errorf("hone.GetListeningMaterial: %w", err)
	}
	return out, nil
}

func (p *ListeningRepoPG) ListMaterials(ctx context.Context, userID uuid.UUID, limit int) ([]domain.ListeningMaterial, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT id, user_id, title, audio_url, transcript_md, archived_at, created_at, updated_at
		FROM hone_listening_materials
		WHERE user_id = $1 AND archived_at IS NULL
		ORDER BY created_at DESC
		LIMIT $2`
	rows, err := p.pool.Query(ctx, q, sharedpg.UUID(userID), limit)
	if err != nil {
		return nil, fmt.Errorf("hone.ListListeningMaterials: %w", err)
	}
	defer rows.Close()
	out := make([]domain.ListeningMaterial, 0, 16)
	for rows.Next() {
		m, err := scanListeningMaterial(rows)
		if err != nil {
			return nil, fmt.Errorf("hone.ListListeningMaterials: scan: %w", err)
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("hone.ListListeningMaterials: rows: %w", err)
	}
	return out, nil
}

func (p *ListeningRepoPG) ArchiveMaterial(ctx context.Context, userID, materialID uuid.UUID, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE hone_listening_materials
		SET archived_at = $1, updated_at = $1
		WHERE id = $2 AND user_id = $3 AND archived_at IS NULL`,
		pgtype.Timestamptz{Time: now, Valid: true}, sharedpg.UUID(materialID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.ArchiveListeningMaterial: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("hone.ArchiveListeningMaterial: %w", domain.ErrNotFound)
	}
	return nil
}

// listeningRowScanner mirrors the rowScanner in reading_repo.go; kept
// local to avoid an export collision with the tutor module's
// rowScanner (different package, no conflict, just style consistency).
type listeningRowScanner interface {
	Scan(dest ...any) error
}

func scanListeningMaterial(r listeningRowScanner) (domain.ListeningMaterial, error) {
	var (
		id, userID                       pgtype.UUID
		title, audioURL, transcriptMD    string
		archivedAt, createdAt, updatedAt pgtype.Timestamptz
	)
	if err := r.Scan(&id, &userID, &title, &audioURL, &transcriptMD, &archivedAt, &createdAt, &updatedAt); err != nil {
		return domain.ListeningMaterial{}, fmt.Errorf("hone.scanListeningMaterial: %w", err)
	}
	m := domain.ListeningMaterial{
		ID:           sharedpg.UUIDFrom(id),
		UserID:       sharedpg.UUIDFrom(userID),
		Title:        title,
		AudioURL:     audioURL,
		TranscriptMD: transcriptMD,
	}
	if archivedAt.Valid {
		t := archivedAt.Time
		m.ArchivedAt = &t
	}
	if createdAt.Valid {
		m.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		m.UpdatedAt = updatedAt.Time
	}
	return m, nil
}
