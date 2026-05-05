// codex_repo.go — Postgres adapter for codex_articles + codex_categories.
//
// SQL kept verbatim from the original chi-direct handlers in
// cmd/monolith/services/admin/codex.go.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Codex is the persistence adapter for codex_articles + codex_categories.
type Codex struct {
	pool *pgxpool.Pool
}

// NewCodex wraps a pool.
func NewCodex(pool *pgxpool.Pool) *Codex { return &Codex{pool: pool} }

const codexArticleCols = `id::text, slug, title, description, category, href, source, read_min, sort_order, active`
const codexCategoryCols = `slug, label, description, sort_order, active`

func scanCodexArticle(row pgx.Row) (domain.CodexArticle, error) {
	var d domain.CodexArticle
	err := row.Scan(&d.ID, &d.Slug, &d.Title, &d.Description, &d.Category,
		&d.Href, &d.Source, &d.ReadMin, &d.SortOrder, &d.Active)
	if err != nil {
		return d, fmt.Errorf("codex.scan: %w", err)
	}
	return d, nil
}

// ListArticles returns codex articles. activeOnly=true filters to active=TRUE.
//
// Phase R5: hard LIMIT 500 cap as a defensive guard. The catalogue grows
// slowly (≈30-100 entries today, expected ~500 long-term) so a single-page
// load remains correct UX. If catalogue ever overflows, switch caller to a
// paginated repo method (cursor on (category, sort_order)).
func (c *Codex) ListArticles(ctx context.Context, activeOnly bool) ([]domain.CodexArticle, error) {
	q := `SELECT ` + codexArticleCols + ` FROM codex_articles ORDER BY category, sort_order ASC LIMIT 500`
	if activeOnly {
		q = `SELECT ` + codexArticleCols + ` FROM codex_articles WHERE active = true ORDER BY category, sort_order ASC LIMIT 500`
	}
	rows, err := c.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("admin.Codex.ListArticles: %w", err)
	}
	defer rows.Close()
	out := make([]domain.CodexArticle, 0, 32)
	for rows.Next() {
		row, err := scanCodexArticle(rows)
		if err != nil {
			continue
		}
		out = append(out, row)
	}
	return out, nil
}

// CreateArticle inserts a row.
func (c *Codex) CreateArticle(ctx context.Context, in domain.CodexArticleUpsert) (domain.CodexArticle, error) {
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	row := c.pool.QueryRow(ctx, `
		INSERT INTO codex_articles (slug, title, description, category, href, source, read_min, sort_order, active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING `+codexArticleCols,
		in.Slug, in.Title, in.Description, in.Category,
		in.Href, in.Source, in.ReadMin, in.SortOrder, active)
	out, err := scanCodexArticle(row)
	if err != nil {
		return domain.CodexArticle{}, fmt.Errorf("admin.Codex.CreateArticle: %w", err)
	}
	return out, nil
}

// UpdateArticle updates a row by id.
func (c *Codex) UpdateArticle(ctx context.Context, id uuid.UUID, in domain.CodexArticleUpsert) (domain.CodexArticle, error) {
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	row := c.pool.QueryRow(ctx, `
		UPDATE codex_articles SET
		  slug=$2, title=$3, description=$4, category=$5,
		  href=$6, source=$7, read_min=$8, sort_order=$9, active=$10,
		  updated_at = now()
		WHERE id = $1
		RETURNING `+codexArticleCols,
		sharedpg.UUID(id), in.Slug, in.Title, in.Description, in.Category,
		in.Href, in.Source, in.ReadMin, in.SortOrder, active)
	out, err := scanCodexArticle(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.CodexArticle{}, domain.ErrNotFound
		}
		return domain.CodexArticle{}, fmt.Errorf("admin.Codex.UpdateArticle: %w", err)
	}
	return out, nil
}

// SetArticleActive toggles the `active` flag.
func (c *Codex) SetArticleActive(ctx context.Context, id uuid.UUID, active bool) error {
	tag, err := c.pool.Exec(ctx,
		`UPDATE codex_articles SET active = $2, updated_at = now() WHERE id = $1`,
		sharedpg.UUID(id), active)
	if err != nil {
		return fmt.Errorf("admin.Codex.SetArticleActive: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// DeleteArticle removes a row.
func (c *Codex) DeleteArticle(ctx context.Context, id uuid.UUID) error {
	tag, err := c.pool.Exec(ctx,
		`DELETE FROM codex_articles WHERE id = $1`, sharedpg.UUID(id))
	if err != nil {
		return fmt.Errorf("admin.Codex.DeleteArticle: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// GetArticleMetaIfActive returns slug/title/category for an active article.
func (c *Codex) GetArticleMetaIfActive(ctx context.Context, id uuid.UUID) (domain.CodexArticleMeta, error) {
	var m domain.CodexArticleMeta
	err := c.pool.QueryRow(ctx,
		`SELECT slug, title, category, read_min FROM codex_articles WHERE id = $1 AND active = true`,
		sharedpg.UUID(id)).Scan(&m.Slug, &m.Title, &m.Category, &m.ReadMin)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return m, domain.ErrNotFound
		}
		return m, fmt.Errorf("admin.Codex.GetArticleMetaIfActive: %w", err)
	}
	return m, nil
}

// ListCategories returns codex categories.
func (c *Codex) ListCategories(ctx context.Context, activeOnly bool) ([]domain.CodexCategory, error) {
	q := `SELECT ` + codexCategoryCols + ` FROM codex_categories ORDER BY sort_order ASC`
	if activeOnly {
		q = `SELECT ` + codexCategoryCols + ` FROM codex_categories WHERE active = true ORDER BY sort_order ASC`
	}
	rows, err := c.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("admin.Codex.ListCategories: %w", err)
	}
	defer rows.Close()
	out := make([]domain.CodexCategory, 0, 8)
	for rows.Next() {
		var cat domain.CodexCategory
		if scanErr := rows.Scan(&cat.Slug, &cat.Label, &cat.Description, &cat.SortOrder, &cat.Active); scanErr != nil {
			continue
		}
		out = append(out, cat)
	}
	return out, nil
}

// CreateCategory inserts a category.
func (c *Codex) CreateCategory(ctx context.Context, in domain.CodexCategory) error {
	_, err := c.pool.Exec(ctx, `
		INSERT INTO codex_categories (slug, label, description, sort_order, active)
		VALUES ($1, $2, $3, $4, $5)`,
		in.Slug, in.Label, in.Description, in.SortOrder, in.Active)
	if err != nil {
		return fmt.Errorf("admin.Codex.CreateCategory: %w", err)
	}
	return nil
}

// UpdateCategory updates a category by slug.
func (c *Codex) UpdateCategory(ctx context.Context, slug string, in domain.CodexCategory) error {
	tag, err := c.pool.Exec(ctx, `
		UPDATE codex_categories SET
		  label = $2, description = $3, sort_order = $4, active = $5,
		  updated_at = now()
		WHERE slug = $1`,
		slug, in.Label, in.Description, in.SortOrder, in.Active)
	if err != nil {
		return fmt.Errorf("admin.Codex.UpdateCategory: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// DeleteCategory removes a category by slug.
func (c *Codex) DeleteCategory(ctx context.Context, slug string) error {
	tag, err := c.pool.Exec(ctx,
		`DELETE FROM codex_categories WHERE slug = $1`, slug)
	if err != nil {
		return fmt.Errorf("admin.Codex.DeleteCategory: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// CountArticlesByCategory returns the number of articles still using slug.
func (c *Codex) CountArticlesByCategory(ctx context.Context, slug string) (int, error) {
	var n int
	if err := c.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM codex_articles WHERE category = $1`, slug).Scan(&n); err != nil {
		return 0, fmt.Errorf("admin.Codex.CountArticlesByCategory: %w", err)
	}
	return n, nil
}

var _ domain.CodexRepo = (*Codex)(nil)
