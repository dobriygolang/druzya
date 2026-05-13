package app

import (
	"context"
	"testing"

	"druz9/admin/domain"
	"druz9/admin/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestListReports_Do_PassesFilterThrough(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockReportRepo(ctrl)
	var captured domain.ReportFilter
	rows := []domain.AdminReport{
		{ID: uuid.New(), Reason: "spam", Status: "pending"},
	}
	repo.EXPECT().List(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, fl domain.ReportFilter) ([]domain.AdminReport, int, error) {
			captured = fl
			return rows, len(rows), nil
		},
	)
	uc := &ListReports{Reports: repo}
	got, total, err := uc.Do(context.Background(), domain.ReportFilter{Status: "resolved", Limit: 5})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if total != 1 || len(got) != 1 {
		t.Fatalf("got total=%d items=%d, want 1/1", total, len(got))
	}
	if captured.Status != "resolved" {
		t.Fatalf("filter status not propagated: got %q", captured.Status)
	}
	if captured.Limit != 5 {
		t.Fatalf("filter limit not propagated: got %d", captured.Limit)
	}
}
