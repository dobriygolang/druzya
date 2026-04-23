// reports.go — moderation queue entities + repo contract.
//
// `user_reports` rows live until a moderator transitions them to
// status='resolved' or 'dismissed'. The list endpoint defaults to status=
// 'pending' so the dashboard counters match the sidebar badge.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// AdminReport mirrors the user_reports row joined against users for the
// reporter / reported display names.
type AdminReport struct {
	ID           uuid.UUID
	ReporterID   uuid.UUID
	ReporterName string
	ReportedID   uuid.UUID
	ReportedName string
	Reason       string
	Description  string
	Status       string
	CreatedAt    time.Time
}

// ReportFilter is the optional predicate on GET /admin/reports.
type ReportFilter struct {
	Status string // "" or "pending" / "resolved" / "dismissed"
	Limit  int
}

// ReportRepo serves the moderation queue.
type ReportRepo interface {
	List(ctx context.Context, f ReportFilter) ([]AdminReport, int, error)
}
