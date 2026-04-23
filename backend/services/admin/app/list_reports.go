// list_reports.go — moderation queue read use case.
package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// ListReports implements GET /api/v1/admin/reports.
type ListReports struct {
	Reports domain.ReportRepo
}

// Do returns matching reports plus a total.
func (uc *ListReports) Do(ctx context.Context, f domain.ReportFilter) ([]domain.AdminReport, int, error) {
	items, total, err := uc.Reports.List(ctx, f)
	if err != nil {
		return nil, 0, fmt.Errorf("admin.ListReports: %w", err)
	}
	return items, total, nil
}
