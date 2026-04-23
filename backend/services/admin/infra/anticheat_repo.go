package infra

import (
	"context"
	"fmt"
	"strings"

	"druz9/admin/domain"
	admindb "druz9/admin/infra/db"
	"druz9/shared/enums"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─────────────────────────────────────────────────────────────────────────
// Anticheat
// ─────────────────────────────────────────────────────────────────────────

// Anticheat is the read-only persistence adapter for anticheat_signals.
type Anticheat struct {
	pool *pgxpool.Pool
	q    *admindb.Queries
}

// NewAnticheat wraps a pool.
func NewAnticheat(pool *pgxpool.Pool) *Anticheat {
	return &Anticheat{pool: pool, q: admindb.New(pool)}
}

// List returns a filtered list of anticheat signals.
//
// NOTE: the filter set (severity, from, limit) is sparsely populated so we
// hand-roll the SQL. The base-case sqlc query covers the no-filter path only.
func (a *Anticheat) List(ctx context.Context, f domain.AnticheatFilter) ([]domain.AnticheatSignal, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}

	// Fast path — no filters → use sqlc query.
	if f.Severity == nil && f.From == nil {
		rows, err := a.q.ListAnticheatSignalsBase(ctx, int32(limit))
		if err != nil {
			return nil, fmt.Errorf("admin.Anticheat.List: base: %w", err)
		}
		out := make([]domain.AnticheatSignal, 0, len(rows))
		for _, r := range rows {
			out = append(out, anticheatFromBaseRow(r))
		}
		return out, nil
	}

	// Filtered path — compose SQL.
	var (
		clauses []string
		args    []any
	)
	argPos := func() string { return fmt.Sprintf("$%d", len(args)+1) }

	if f.Severity != nil && *f.Severity != "" {
		clauses = append(clauses, "s.severity = "+argPos())
		args = append(args, string(*f.Severity))
	}
	if f.From != nil {
		clauses = append(clauses, "s.created_at >= "+argPos())
		args = append(args, f.From.UTC())
	}
	where := ""
	if len(clauses) > 0 {
		where = " WHERE " + strings.Join(clauses, " AND ")
	}
	sql := `SELECT s.id, s.user_id, u.username, s.match_id, s.type, s.severity,
                   s.metadata, s.created_at
              FROM anticheat_signals s
              LEFT JOIN users u ON u.id = s.user_id` + where +
		fmt.Sprintf(" ORDER BY s.created_at DESC LIMIT %d", limit)

	rows, err := a.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("admin.Anticheat.List: query: %w", err)
	}
	defer rows.Close()

	out := make([]domain.AnticheatSignal, 0)
	for rows.Next() {
		var r anticheatRow
		if err := rows.Scan(
			&r.ID, &r.UserID, &r.Username, &r.MatchID,
			&r.Type, &r.Severity, &r.Metadata, &r.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("admin.Anticheat.List: scan: %w", err)
		}
		out = append(out, anticheatFromRow(r))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin.Anticheat.List: rows: %w", err)
	}
	return out, nil
}

// anticheatRow mirrors the columns selected in both the sqlc base query and
// the hand-rolled filtered query.
type anticheatRow struct {
	ID        pgtype.UUID
	UserID    pgtype.UUID
	Username  pgtype.Text
	MatchID   pgtype.UUID
	Type      string
	Severity  string
	Metadata  []byte
	CreatedAt pgtype.Timestamptz
}

func anticheatFromRow(r anticheatRow) domain.AnticheatSignal {
	out := domain.AnticheatSignal{
		ID:        fromPgUUID(r.ID),
		UserID:    fromPgUUID(r.UserID),
		Username:  r.Username.String,
		Type:      enums.AnticheatSignalType(r.Type),
		Severity:  enums.SeverityLevel(r.Severity),
		Metadata:  append([]byte(nil), r.Metadata...),
		CreatedAt: r.CreatedAt.Time,
	}
	if r.MatchID.Valid {
		m := fromPgUUID(r.MatchID)
		out.MatchID = &m
	}
	return out
}

func anticheatFromBaseRow(r admindb.ListAnticheatSignalsBaseRow) domain.AnticheatSignal {
	return anticheatFromRow(anticheatRow{
		ID: r.ID, UserID: r.UserID, Username: r.Username, MatchID: r.MatchID,
		Type: r.Type, Severity: r.Severity, Metadata: r.Metadata, CreatedAt: r.CreatedAt,
	})
}
