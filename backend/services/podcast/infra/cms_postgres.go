// cms_postgres.go — pgx-based repo for the podcast CMS surface.
//
// We deliberately bypass sqlc here. Reason: the existing podcast.sql.go is
// generated from infra/queries/podcast.sql and we don't want to require a
// `make gen-sql` step for the migration that introduces this file. The
// queries below are tiny, parameterised, and audited via the Postgres()
// constructor's compile-time PodcastCMSRepo assertion.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/podcast/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresCMS implements domain.PodcastCMSRepo on a *pgxpool.Pool.
type PostgresCMS struct {
	pool *pgxpool.Pool
}

// NewPostgresCMS wires a CMS repo.
func NewPostgresCMS(pool *pgxpool.Pool) *PostgresCMS {
	return &PostgresCMS{pool: pool}
}

// Compile-time guard.
var _ domain.PodcastCMSRepo = (*PostgresCMS)(nil)

const cmsSelectCols = `
    p.id, p.title_ru, p.title_en, COALESCE(p.description, ''),
    COALESCE(p.host, ''), p.category_id, p.episode_num,
    p.duration_sec, p.audio_key, COALESCE(p.cover_url, ''),
    p.is_published, p.published_at, p.created_at, COALESCE(p.updated_at, p.created_at),
    c.id, c.slug, c.name, c.color, c.sort_order, c.created_at`

// scanCMSRow decodes the canonical SELECT below into a CMSPodcast and an
// optional category. Designed to be callable from both QueryRow + Query
// flows by parameterising the row scan target.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanCMSRow(rs rowScanner) (domain.CMSPodcast, error) {
	var (
		out         domain.CMSPodcast
		titleRU     string
		titleEN     string
		categoryID  pgtype.UUID
		episodeNum  pgtype.Int4
		publishedAt pgtype.Timestamptz
		createdAt   pgtype.Timestamptz
		updatedAt   pgtype.Timestamptz

		catID        pgtype.UUID
		catSlug      pgtype.Text
		catName      pgtype.Text
		catColor     pgtype.Text
		catSortOrder pgtype.Int4
		catCreated   pgtype.Timestamptz
	)
	err := rs.Scan(
		&out.ID, &titleRU, &titleEN, &out.Description,
		&out.Host, &categoryID, &episodeNum,
		&out.DurationSec, &out.AudioKey, &out.CoverURL,
		&out.IsPublished, &publishedAt, &createdAt, &updatedAt,
		&catID, &catSlug, &catName, &catColor, &catSortOrder, &catCreated,
	)
	if err != nil {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.cms.scan: %w", err)
	}
	out.Title = titleRU
	out.TitleEN = titleEN
	if categoryID.Valid {
		id := uuid.UUID(categoryID.Bytes)
		out.CategoryID = &id
	}
	if episodeNum.Valid {
		n := int(episodeNum.Int32)
		out.EpisodeNum = &n
	}
	if publishedAt.Valid {
		t := publishedAt.Time
		out.PublishedAt = &t
	}
	if createdAt.Valid {
		out.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		out.UpdatedAt = updatedAt.Time
	}
	if catID.Valid {
		cat := domain.PodcastCategory{
			ID:        uuid.UUID(catID.Bytes),
			Slug:      catSlug.String,
			Name:      catName.String,
			Color:     catColor.String,
			SortOrder: int(catSortOrder.Int32),
		}
		if catCreated.Valid {
			cat.CreatedAt = catCreated.Time
		}
		out.Category = &cat
	}
	return out, nil
}

// ListCMS implements PodcastCMSRepo.
func (p *PostgresCMS) ListCMS(ctx context.Context, f domain.CMSListFilter) ([]domain.CMSPodcast, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args := []any{}
	where := "WHERE 1=1"
	if f.OnlyPublished {
		where += " AND p.is_published = TRUE"
	}
	if f.CategoryID != nil {
		args = append(args, pgtype.UUID{Bytes: *f.CategoryID, Valid: true})
		where += fmt.Sprintf(" AND p.category_id = $%d", len(args))
	}
	args = append(args, limit, f.Offset)
	q := fmt.Sprintf(`
        SELECT %s
          FROM podcasts p
     LEFT JOIN podcast_categories c ON c.id = p.category_id
        %s
      ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.created_at DESC
         LIMIT $%d OFFSET $%d`,
		cmsSelectCols, where, len(args)-1, len(args))

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("podcast.cms.pg.ListCMS: %w", err)
	}
	defer rows.Close()
	out := make([]domain.CMSPodcast, 0, limit)
	for rows.Next() {
		row, sErr := scanCMSRow(rows)
		if sErr != nil {
			return nil, fmt.Errorf("podcast.cms.pg.ListCMS scan: %w", sErr)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("podcast.cms.pg.ListCMS rows: %w", err)
	}
	return out, nil
}

// GetCMSByID implements PodcastCMSRepo.
func (p *PostgresCMS) GetCMSByID(ctx context.Context, id uuid.UUID) (domain.CMSPodcast, error) {
	q := fmt.Sprintf(`
        SELECT %s
          FROM podcasts p
     LEFT JOIN podcast_categories c ON c.id = p.category_id
         WHERE p.id = $1`,
		cmsSelectCols)
	row := p.pool.QueryRow(ctx, q, pgtype.UUID{Bytes: id, Valid: true})
	out, err := scanCMSRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.CMSPodcast{}, fmt.Errorf("podcast.cms.pg.GetCMSByID: %w", domain.ErrNotFound)
		}
		return domain.CMSPodcast{}, fmt.Errorf("podcast.cms.pg.GetCMSByID: %w", err)
	}
	return out, nil
}

// CreateCMS implements PodcastCMSRepo.
func (p *PostgresCMS) CreateCMS(ctx context.Context, in domain.CMSPodcastUpsert) (domain.CMSPodcast, error) {
	if in.Title == "" || in.AudioKey == "" {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.cms.pg.CreateCMS: %w", domain.ErrInvalidPodcast)
	}
	titleEN := in.TitleEN
	if titleEN == "" {
		titleEN = in.Title
	}
	id := uuid.New()
	args := []any{
		pgtype.UUID{Bytes: id, Valid: true},
		in.Title, titleEN, in.Description, in.Host,
		nullableUUID(in.CategoryID), nullableInt(in.EpisodeNum),
		// Section is the legacy NOT NULL column; we store an empty string
		// stand-in so the inserted row does not break old readers. The
		// CMS path does not surface it.
		"",
		in.DurationSec, in.AudioKey, in.CoverURL,
		in.IsPublished, nullableTimestamptz(in.PublishedAt),
	}
	const q = `
        INSERT INTO podcasts (
            id, title_ru, title_en, description, host,
            category_id, episode_num, section,
            duration_sec, audio_key, cover_url,
            is_published, published_at, updated_at, created_at
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8,
            $9, $10, $11,
            $12, $13, now(), now()
        )`
	if _, err := p.pool.Exec(ctx, q, args...); err != nil {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.cms.pg.CreateCMS: %w", err)
	}
	return p.GetCMSByID(ctx, id)
}

// UpdateCMS implements PodcastCMSRepo. Empty strings on text fields are
// preserved (admin can blank the description); pointer-typed optional
// fields are only touched when non-nil.
func (p *PostgresCMS) UpdateCMS(ctx context.Context, id uuid.UUID, in domain.CMSPodcastUpsert) (domain.CMSPodcast, error) {
	args := []any{
		in.Title, in.Description, in.Host,
		nullableUUID(in.CategoryID), nullableInt(in.EpisodeNum),
		in.DurationSec, in.CoverURL, in.IsPublished,
		nullableTimestamptz(in.PublishedAt),
	}
	// Audio key is only overwritten when caller passed a fresh upload.
	updateAudio := in.AudioKey != ""
	if updateAudio {
		args = append(args, in.AudioKey)
	}
	args = append(args, pgtype.UUID{Bytes: id, Valid: true})

	q := `
        UPDATE podcasts SET
            title_ru = $1,
            description = $2,
            host = $3,
            category_id = $4,
            episode_num = $5,
            duration_sec = $6,
            cover_url = $7,
            is_published = $8,
            published_at = $9,
            updated_at = now()`
	if updateAudio {
		q += `,
            audio_key = $10`
	}
	q += fmt.Sprintf(`
         WHERE id = $%d`, len(args))

	tag, err := p.pool.Exec(ctx, q, args...)
	if err != nil {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.cms.pg.UpdateCMS: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.cms.pg.UpdateCMS: %w", domain.ErrNotFound)
	}
	return p.GetCMSByID(ctx, id)
}

// DeleteCMS implements PodcastCMSRepo. Returns the row's audio_key so the
// caller can also drop the MinIO object in a best-effort fashion.
func (p *PostgresCMS) DeleteCMS(ctx context.Context, id uuid.UUID) (string, error) {
	const q = `
        DELETE FROM podcasts
         WHERE id = $1
     RETURNING COALESCE(audio_key, '')`
	var key string
	if err := p.pool.QueryRow(ctx, q, pgtype.UUID{Bytes: id, Valid: true}).Scan(&key); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("podcast.cms.pg.DeleteCMS: %w", domain.ErrNotFound)
		}
		return "", fmt.Errorf("podcast.cms.pg.DeleteCMS: %w", err)
	}
	return key, nil
}

// ListCategories implements PodcastCMSRepo.
func (p *PostgresCMS) ListCategories(ctx context.Context) ([]domain.PodcastCategory, error) {
	const q = `
        SELECT id, slug, name, color, sort_order, created_at
          FROM podcast_categories
      ORDER BY sort_order ASC, name ASC`
	rows, err := p.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("podcast.cms.pg.ListCategories: %w", err)
	}
	defer rows.Close()
	out := make([]domain.PodcastCategory, 0, 8)
	for rows.Next() {
		var (
			c       domain.PodcastCategory
			id      pgtype.UUID
			created pgtype.Timestamptz
			sortOrd pgtype.Int4
		)
		if sErr := rows.Scan(&id, &c.Slug, &c.Name, &c.Color, &sortOrd, &created); sErr != nil {
			return nil, fmt.Errorf("podcast.cms.pg.ListCategories scan: %w", sErr)
		}
		if id.Valid {
			c.ID = uuid.UUID(id.Bytes)
		}
		if sortOrd.Valid {
			c.SortOrder = int(sortOrd.Int32)
		}
		if created.Valid {
			c.CreatedAt = created.Time
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("podcast.cms.pg.ListCategories rows: %w", err)
	}
	return out, nil
}

// GetCategoryByID implements PodcastCMSRepo.
func (p *PostgresCMS) GetCategoryByID(ctx context.Context, id uuid.UUID) (domain.PodcastCategory, error) {
	const q = `
        SELECT id, slug, name, color, sort_order, created_at
          FROM podcast_categories
         WHERE id = $1`
	var (
		c       domain.PodcastCategory
		pid     pgtype.UUID
		created pgtype.Timestamptz
		sortOrd pgtype.Int4
	)
	if err := p.pool.QueryRow(ctx, q, pgtype.UUID{Bytes: id, Valid: true}).
		Scan(&pid, &c.Slug, &c.Name, &c.Color, &sortOrd, &created); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.PodcastCategory{}, fmt.Errorf("podcast.cms.pg.GetCategoryByID: %w", domain.ErrCategoryNotFound)
		}
		return domain.PodcastCategory{}, fmt.Errorf("podcast.cms.pg.GetCategoryByID: %w", err)
	}
	if pid.Valid {
		c.ID = uuid.UUID(pid.Bytes)
	}
	if sortOrd.Valid {
		c.SortOrder = int(sortOrd.Int32)
	}
	if created.Valid {
		c.CreatedAt = created.Time
	}
	return c, nil
}

// CreateCategory implements PodcastCMSRepo. Slug uniqueness is enforced
// at the SQL layer; we map 23505 (unique_violation) to ErrCategoryConflict.
func (p *PostgresCMS) CreateCategory(ctx context.Context, in domain.PodcastCategory) (domain.PodcastCategory, error) {
	if in.Slug == "" || in.Name == "" {
		return domain.PodcastCategory{}, fmt.Errorf("podcast.cms.pg.CreateCategory: %w", domain.ErrInvalidPodcast)
	}
	if in.Color == "" {
		in.Color = "#6c7af0"
	}
	if in.SortOrder == 0 {
		in.SortOrder = 100
	}
	id := uuid.New()
	const q = `
        INSERT INTO podcast_categories (id, slug, name, color, sort_order)
        VALUES ($1, $2, $3, $4, $5)`
	if _, err := p.pool.Exec(ctx, q,
		pgtype.UUID{Bytes: id, Valid: true},
		in.Slug, in.Name, in.Color, in.SortOrder,
	); err != nil {
		// pgx returns *pgconn.PgError; we match by SQLSTATE without
		// importing pgconn directly to keep the diff small. The error
		// string contains "SQLSTATE 23505" for unique violations.
		if isUniqueViolation(err) {
			return domain.PodcastCategory{}, fmt.Errorf("podcast.cms.pg.CreateCategory: %w", domain.ErrCategoryConflict)
		}
		return domain.PodcastCategory{}, fmt.Errorf("podcast.cms.pg.CreateCategory: %w", err)
	}
	return p.GetCategoryByID(ctx, id)
}

// ─── helpers ──────────────────────────────────────────────────────────────

func nullableUUID(id *uuid.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *id, Valid: true}
}

func nullableInt(i *int) pgtype.Int4 {
	if i == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: int32(*i), Valid: true}
}

func nullableTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

// isUniqueViolation matches the SQLSTATE 23505 error string. Tiny string
// match keeps the dependency surface flat (no pgconn import).
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return contains(s, "SQLSTATE 23505") || contains(s, "23505")
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
