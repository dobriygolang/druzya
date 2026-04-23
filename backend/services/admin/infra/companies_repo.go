package infra

import (
	"context"
	"fmt"

	"druz9/admin/domain"
	admindb "druz9/admin/infra/db"
	"druz9/shared/enums"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ─────────────────────────────────────────────────────────────────────────
// Companies
// ─────────────────────────────────────────────────────────────────────────

// Companies is the persistence adapter for the companies table.
type Companies struct {
	q *admindb.Queries
}

// NewCompanies wraps a pool.
func NewCompanies(pool *pgxpool.Pool) *Companies {
	return &Companies{q: admindb.New(pool)}
}

// List returns every company, ordered by name.
func (c *Companies) List(ctx context.Context) ([]domain.AdminCompany, error) {
	rows, err := c.q.ListCompanies(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin.Companies.List: %w", err)
	}
	out := make([]domain.AdminCompany, 0, len(rows))
	for _, r := range rows {
		out = append(out, companyFromRow(r))
	}
	return out, nil
}

// Upsert creates or refreshes a company row keyed by slug.
func (c *Companies) Upsert(ctx context.Context, in domain.CompanyUpsert) (domain.AdminCompany, error) {
	row, err := c.q.UpsertCompany(ctx, admindb.UpsertCompanyParams{
		Slug:             in.Slug,
		Name:             in.Name,
		Difficulty:       string(in.Difficulty),
		MinLevelRequired: int32(in.MinLevelRequired),
	})
	if err != nil {
		return domain.AdminCompany{}, fmt.Errorf("admin.Companies.Upsert: %w", mapUniqueErr(err))
	}
	return companyFromRow(row), nil
}

func companyFromRow(r admindb.Company) domain.AdminCompany {
	sections := make([]enums.Section, 0, len(r.Sections))
	for _, s := range r.Sections {
		sections = append(sections, enums.Section(s))
	}
	return domain.AdminCompany{
		ID:               fromPgUUID(r.ID),
		Slug:             r.Slug,
		Name:             r.Name,
		Difficulty:       enums.DungeonTier(r.Difficulty),
		MinLevelRequired: int(r.MinLevelRequired),
		Sections:         sections,
		CreatedAt:        r.CreatedAt.Time,
	}
}
