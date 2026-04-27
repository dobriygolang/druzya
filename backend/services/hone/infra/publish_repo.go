// publish_repo.go — Phase C-4 «Publish to web» персистенция. SQL перенесён
// дословно из cmd/monolith/services/hone/publishing.go.
package infra

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PublishRepoPG — Postgres impl of domain.PublishRepo.
type PublishRepoPG struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

// NewPublishRepo wraps pool + logger. log опционален (nil → slog.Default).
func NewPublishRepo(pool *pgxpool.Pool, log *slog.Logger) *PublishRepoPG {
	if log == nil {
		log = slog.Default()
	}
	return &PublishRepoPG{pool: pool, log: log}
}

// LookupForPublish — read current slug+at+encrypted by (id, user_id).
func (r *PublishRepoPG) LookupForPublish(ctx context.Context, userID, noteID uuid.UUID) (domain.PublishLookup, error) {
	var (
		existingSlug *string
		existingAt   *time.Time
		encrypted    bool
	)
	err := r.pool.QueryRow(ctx,
		`SELECT public_slug, published_at, encrypted FROM hone_notes
		  WHERE id=$1 AND user_id=$2`,
		noteID, userID,
	).Scan(&existingSlug, &existingAt, &encrypted)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.PublishLookup{}, domain.ErrNotFound
		}
		return domain.PublishLookup{}, fmt.Errorf("hone.PublishRepoPG.LookupForPublish: %w", err)
	}
	return domain.PublishLookup{
		Slug:        existingSlug,
		PublishedAt: existingAt,
		Encrypted:   encrypted,
	}, nil
}

// SetPublishSlug — UPDATE … RETURNING. UNIQUE-violation (23505) →
// ErrPublishSlugCollision; ErrNoRows → ErrNotFound.
func (r *PublishRepoPG) SetPublishSlug(ctx context.Context, userID, noteID uuid.UUID, slug string) (string, time.Time, error) {
	var (
		newSlug string
		newAt   time.Time
	)
	err := r.pool.QueryRow(ctx,
		`UPDATE hone_notes
		    SET public_slug = $3, published_at = now()
		  WHERE id = $1 AND user_id = $2
		RETURNING public_slug, published_at`,
		noteID, userID, slug,
	).Scan(&newSlug, &newAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", time.Time{}, domain.ErrNotFound
		}
		// Unique-violation = SQLSTATE 23505.
		if strings.Contains(err.Error(), "23505") {
			return "", time.Time{}, domain.ErrPublishSlugCollision
		}
		return "", time.Time{}, fmt.Errorf("hone.PublishRepoPG.SetPublishSlug: %w", err)
	}
	return newSlug, newAt, nil
}

// ClearPublish — UPDATE … SET slug=NULL, at=NULL. RowsAffected=0 → ErrNotFound.
func (r *PublishRepoPG) ClearPublish(ctx context.Context, userID, noteID uuid.UUID) error {
	cmd, err := r.pool.Exec(ctx,
		`UPDATE hone_notes
		    SET public_slug = NULL, published_at = NULL
		  WHERE id = $1 AND user_id = $2`,
		noteID, userID,
	)
	if err != nil {
		return fmt.Errorf("hone.PublishRepoPG.ClearPublish: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// GetPublishStatus — read-only slug+at.
func (r *PublishRepoPG) GetPublishStatus(ctx context.Context, userID, noteID uuid.UUID) (*string, *time.Time, error) {
	var (
		slugVal *string
		atVal   *time.Time
	)
	err := r.pool.QueryRow(ctx,
		`SELECT public_slug, published_at FROM hone_notes
		  WHERE id=$1 AND user_id=$2`,
		noteID, userID,
	).Scan(&slugVal, &atVal)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, domain.ErrNotFound
		}
		return nil, nil, fmt.Errorf("hone.PublishRepoPG.GetPublishStatus: %w", err)
	}
	return slugVal, atVal, nil
}

// ListNotesMeta — bulk meta: id, encrypted, published.
func (r *PublishRepoPG) ListNotesMeta(ctx context.Context, userID uuid.UUID) ([]domain.NoteMeta, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, encrypted, (public_slug IS NOT NULL AND published_at IS NOT NULL) AS published
		   FROM hone_notes
		  WHERE user_id = $1 AND archived_at IS NULL`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("hone.PublishRepoPG.ListNotesMeta: %w", err)
	}
	defer rows.Close()
	out := make([]domain.NoteMeta, 0, 32)
	for rows.Next() {
		var m domain.NoteMeta
		if err := rows.Scan(&m.ID, &m.Encrypted, &m.Published); err != nil {
			return nil, fmt.Errorf("hone.PublishRepoPG.ListNotesMeta: scan: %w", err)
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.PublishRepoPG.ListNotesMeta: rows: %w", err)
	}
	return out, nil
}

// GetPublicView — title+body+updatedAt by slug.
func (r *PublishRepoPG) GetPublicView(ctx context.Context, slug string) (string, string, time.Time, error) {
	var (
		title     string
		bodyMD    string
		updatedAt time.Time
	)
	err := r.pool.QueryRow(ctx,
		`SELECT title, body_md, updated_at FROM hone_notes
		  WHERE public_slug = $1 AND published_at IS NOT NULL
		    AND archived_at IS NULL`,
		slug,
	).Scan(&title, &bodyMD, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", time.Time{}, domain.ErrNotFound
		}
		return "", "", time.Time{}, fmt.Errorf("hone.PublishRepoPG.GetPublicView: %w", err)
	}
	return title, bodyMD, updatedAt, nil
}

// Compile-time assertion.
var _ domain.PublishRepo = (*PublishRepoPG)(nil)
