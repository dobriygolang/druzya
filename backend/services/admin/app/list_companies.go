package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// ListCompanies implements GET /api/v1/admin/companies.
type ListCompanies struct {
	Companies domain.CompanyRepo
}

// Do returns every company known to the system.
func (uc *ListCompanies) Do(ctx context.Context) ([]domain.AdminCompany, error) {
	out, err := uc.Companies.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin.ListCompanies: %w", err)
	}
	return out, nil
}
