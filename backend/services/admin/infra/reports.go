// reports.go — Postgres adapter for the moderation queue.
package infra

import (
	"context"
	"fmt"
	"strings"

	"druz9/admin/domain"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Reports is the read-only adapter over user_reports.
type Reports struct {
	pool *pgxpool.Pool
}

// NewReports wraps a pool.
func NewReports(pool *pgxpool.Pool) *Reports { return &Reports{pool: pool} }

const (
	defaultReportLimit = 50
	maxReportLimit     = 200
)

// List returns matching reports + a total count.
func (r *Reports) List(ctx context.Context, f domain.ReportFilter) ([]domain.AdminReport, int, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = defaultReportLimit
	}
	if limit > maxReportLimit {
		limit = maxReportLimit
	}

	status := strings.TrimSpace(strings.ToLower(f.Status))
	if status == "" {
		status = "pending"
	}

	var (
		clauses []string
		args    []any
	)
	if status != "all" {
		clauses = append(clauses, "r.status = $1")
		args = append(args, status)
	}
	where := ""
	if len(clauses) > 0 {
		where = " WHERE " + strings.Join(clauses, " AND ")
	}

	// Tolerate "table does not exist" — fresh environment without the
	// 00011 migration applied returns an empty list rather than 500.
	var total int64
	if err := r.pool.QueryRow(ctx, "SELECT COUNT(*)::bigint FROM user_reports r"+where, args...).Scan(&total); err != nil {
		if isMissingRelation(err) {
			return []domain.AdminReport{}, 0, nil
		}
		return nil, 0, fmt.Errorf("admin.Reports.List: count: %w", err)
	}

	rows, err := r.pool.Query(ctx, `
		SELECT r.id,
		       r.reporter_id,  COALESCE(reporter.username, ''),
		       r.reported_id,  COALESCE(reported.username, ''),
		       r.reason, r.description, r.status, r.created_at
		  FROM user_reports r
		  LEFT JOIN users reporter ON reporter.id = r.reporter_id
		  LEFT JOIN users reported ON reported.id = r.reported_id`+where+
		fmt.Sprintf(" ORDER BY r.created_at DESC LIMIT %d", limit), args...)
	if err != nil {
		if isMissingRelation(err) {
			return []domain.AdminReport{}, 0, nil
		}
		return nil, 0, fmt.Errorf("admin.Reports.List: query: %w", err)
	}
	defer rows.Close()

	out := make([]domain.AdminReport, 0)
	for rows.Next() {
		var rec domain.AdminReport
		var created pgtype.Timestamptz
		if err := rows.Scan(
			&rec.ID, &rec.ReporterID, &rec.ReporterName,
			&rec.ReportedID, &rec.ReportedName,
			&rec.Reason, &rec.Description, &rec.Status, &created,
		); err != nil {
			return nil, 0, fmt.Errorf("admin.Reports.List: scan: %w", err)
		}
		rec.CreatedAt = created.Time.UTC()
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("admin.Reports.List: rows: %w", err)
	}
	return out, int(total), nil
}

// Compile-time assertion.
var _ domain.ReportRepo = (*Reports)(nil)
