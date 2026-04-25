package infra

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/mock_interview/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Companies struct{ pool *pgxpool.Pool }

func NewCompanies(pool *pgxpool.Pool) *Companies { return &Companies{pool: pool} }

const companyCols = `id, slug, name, difficulty, min_level_required, sections,
	COALESCE(logo_url,''), description, active, sort_order, created_at, updated_at`

func (r *Companies) scanRow(row pgx.Row) (domain.Company, error) {
	var (
		id               pgtype.UUID
		slug, name       string
		difficulty       string
		minLevelRequired int
		sections         []string
		logoURL          string
		description      string
		active           bool
		sortOrder        int
		createdAt        time.Time
		updatedAt        time.Time
	)
	err := row.Scan(&id, &slug, &name, &difficulty, &minLevelRequired, &sections,
		&logoURL, &description, &active, &sortOrder, &createdAt, &updatedAt)
	if err != nil {
		return domain.Company{}, fmt.Errorf("row.Scan companies: %w", err)
	}
	return domain.Company{
		ID:               sharedpg.UUIDFrom(id),
		Slug:             slug,
		Name:             name,
		Difficulty:       difficulty,
		MinLevelRequired: minLevelRequired,
		Sections:         sections,
		LogoURL:          logoURL,
		Description:      description,
		Active:           active,
		SortOrder:        sortOrder,
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}, nil
}

func (r *Companies) List(ctx context.Context, onlyActive bool) ([]domain.Company, error) {
	q := `SELECT ` + companyCols + ` FROM companies`
	if onlyActive {
		q += ` WHERE active = true`
	}
	q += ` ORDER BY sort_order ASC, name ASC`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("mock_interview.Companies.List: %w", err)
	}
	defer rows.Close()
	var out []domain.Company
	for rows.Next() {
		c, err := r.scanRow(rows)
		if err != nil {
			return nil, fmt.Errorf("mock_interview.Companies.List scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mock_interview.Companies.List rows: %w", err)
	}
	return out, nil
}

func (r *Companies) Get(ctx context.Context, id uuid.UUID) (domain.Company, error) {
	c, err := r.scanRow(r.pool.QueryRow(ctx,
		`SELECT `+companyCols+` FROM companies WHERE id=$1`, sharedpg.UUID(id)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Company{}, domain.ErrNotFound
		}
		return domain.Company{}, fmt.Errorf("mock_interview.Companies.Get: %w", err)
	}
	return c, nil
}

func (r *Companies) GetBySlug(ctx context.Context, slug string) (domain.Company, error) {
	c, err := r.scanRow(r.pool.QueryRow(ctx,
		`SELECT `+companyCols+` FROM companies WHERE slug=$1`, slug))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Company{}, domain.ErrNotFound
		}
		return domain.Company{}, fmt.Errorf("mock_interview.Companies.GetBySlug: %w", err)
	}
	return c, nil
}

func (r *Companies) Create(ctx context.Context, c domain.Company) (domain.Company, error) {
	var logoURL *string
	if c.LogoURL != "" {
		v := c.LogoURL
		logoURL = &v
	}
	if c.Sections == nil {
		c.Sections = []string{}
	}
	row := r.pool.QueryRow(ctx, `
		INSERT INTO companies (id, slug, name, difficulty, min_level_required, sections,
		                       logo_url, description, active, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING `+companyCols,
		sharedpg.UUID(c.ID), c.Slug, c.Name, c.Difficulty, c.MinLevelRequired, c.Sections,
		logoURL, c.Description, c.Active, c.SortOrder)
	out, err := r.scanRow(row)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.Company{}, fmt.Errorf("slug already exists: %w", domain.ErrConflict)
		}
		return domain.Company{}, fmt.Errorf("mock_interview.Companies.Create: %w", err)
	}
	return out, nil
}

func (r *Companies) Update(ctx context.Context, c domain.Company) (domain.Company, error) {
	var logoURL *string
	if c.LogoURL != "" {
		v := c.LogoURL
		logoURL = &v
	}
	row := r.pool.QueryRow(ctx, `
		UPDATE companies SET
			name=$2, difficulty=$3, min_level_required=$4, sections=$5,
			logo_url=$6, description=$7, active=$8, sort_order=$9, updated_at=now()
		WHERE id=$1
		RETURNING `+companyCols,
		sharedpg.UUID(c.ID), c.Name, c.Difficulty, c.MinLevelRequired, c.Sections,
		logoURL, c.Description, c.Active, c.SortOrder)
	out, err := r.scanRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Company{}, domain.ErrNotFound
		}
		return domain.Company{}, fmt.Errorf("mock_interview.Companies.Update: %w", err)
	}
	return out, nil
}

func (r *Companies) SetActive(ctx context.Context, id uuid.UUID, active bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE companies SET active=$2, updated_at=now() WHERE id=$1`,
		sharedpg.UUID(id), active)
	if err != nil {
		return fmt.Errorf("mock_interview.Companies.SetActive: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// isUniqueViolation — pg "23505" unique_violation. The shared pkg has no
// helper for this, so we sniff the error string. Stable enough for the
// admin-create error message; orchestrator code should never collide.
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "23505")
}

var _ domain.CompanyRepo = (*Companies)(nil)
