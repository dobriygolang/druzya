package app

import (
	"context"
	"testing"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

type fakeReportRepo struct {
	last domain.ReportFilter
	rows []domain.AdminReport
}

func (f *fakeReportRepo) List(_ context.Context, fl domain.ReportFilter) ([]domain.AdminReport, int, error) {
	f.last = fl
	return f.rows, len(f.rows), nil
}

func TestListReports_Do_PassesFilterThrough(t *testing.T) {
	t.Parallel()
	repo := &fakeReportRepo{rows: []domain.AdminReport{
		{ID: uuid.New(), Reason: "spam", Status: "pending"},
	}}
	uc := &ListReports{Reports: repo}
	got, total, err := uc.Do(context.Background(), domain.ReportFilter{Status: "resolved", Limit: 5})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if total != 1 || len(got) != 1 {
		t.Fatalf("got total=%d items=%d, want 1/1", total, len(got))
	}
	if repo.last.Status != "resolved" {
		t.Fatalf("filter status not propagated: got %q", repo.last.Status)
	}
	if repo.last.Limit != 5 {
		t.Fatalf("filter limit not propagated: got %d", repo.last.Limit)
	}
}
