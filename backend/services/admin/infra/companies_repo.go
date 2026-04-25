package infra

import (
	"context"
	"fmt"

	"druz9/admin/domain"
	admindb "druz9/admin/infra/db"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ─────────────────────────────────────────────────────────────────────────
// Companies — schema перешла на mock-interview shape (см. 00043).
// difficulty/min_level_required/sections удалены; logo_url/description/
// active/sort_order — новые. SELECT/UPSERT queries теперь используют новые
// поля, см. services/admin/infra/queries/admin.sql.
// ─────────────────────────────────────────────────────────────────────────

// Companies is the persistence adapter for the companies table.
type Companies struct {
	q *admindb.Queries
}

// NewCompanies wraps a pool.
func NewCompanies(pool *pgxpool.Pool) *Companies {
	return &Companies{q: admindb.New(pool)}
}

// List returns every company, ordered by sort_order then name.
func (c *Companies) List(ctx context.Context) ([]domain.AdminCompany, error) {
	rows, err := c.q.ListCompanies(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin.Companies.List: %w", err)
	}
	out := make([]domain.AdminCompany, 0, len(rows))
	for _, r := range rows {
		out = append(out, companyFromListRow(r))
	}
	return out, nil
}

// Upsert creates or refreshes a company row keyed by slug.
func (c *Companies) Upsert(ctx context.Context, in domain.CompanyUpsert) (domain.AdminCompany, error) {
	logo := pgText(in.LogoURL)
	row, err := c.q.UpsertCompany(ctx, admindb.UpsertCompanyParams{
		Slug:        in.Slug,
		Name:        in.Name,
		LogoUrl:     logo,
		Description: in.Description,
		Active:      in.Active,
	})
	if err != nil {
		return domain.AdminCompany{}, fmt.Errorf("admin.Companies.Upsert: %w", mapUniqueErr(err))
	}
	return companyFromUpsertRow(row), nil
}

func companyFromListRow(r admindb.ListCompaniesRow) domain.AdminCompany {
	logo := ""
	if r.LogoUrl.Valid {
		logo = r.LogoUrl.String
	}
	return domain.AdminCompany{
		ID:          sharedpg.UUIDFrom(r.ID),
		Slug:        r.Slug,
		Name:        r.Name,
		LogoURL:     logo,
		Description: r.Description,
		Active:      r.Active,
		SortOrder:   int(r.SortOrder),
		CreatedAt:   r.CreatedAt.Time,
	}
}

func companyFromUpsertRow(r admindb.UpsertCompanyRow) domain.AdminCompany {
	logo := ""
	if r.LogoUrl.Valid {
		logo = r.LogoUrl.String
	}
	return domain.AdminCompany{
		ID:          sharedpg.UUIDFrom(r.ID),
		Slug:        r.Slug,
		Name:        r.Name,
		LogoURL:     logo,
		Description: r.Description,
		Active:      r.Active,
		SortOrder:   int(r.SortOrder),
		CreatedAt:   r.CreatedAt.Time,
	}
}
