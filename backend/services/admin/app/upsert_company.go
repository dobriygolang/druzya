package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// UpsertCompany implements POST /api/v1/admin/companies.
//
// The endpoint is a create-or-update by slug — curators POST the same slug
// twice to edit their existing row.
type UpsertCompany struct {
	Companies domain.CompanyRepo
}

// Do validates and persists a company.
func (uc *UpsertCompany) Do(ctx context.Context, in domain.CompanyUpsert) (domain.AdminCompany, error) {
	if err := domain.ValidateCompanyUpsert(in); err != nil {
		return domain.AdminCompany{}, fmt.Errorf("admin.UpsertCompany: %w", err)
	}
	out, err := uc.Companies.Upsert(ctx, in)
	if err != nil {
		return domain.AdminCompany{}, fmt.Errorf("admin.UpsertCompany: %w", err)
	}
	return out, nil
}
