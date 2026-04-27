package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/sync/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Replication — Postgres adapter for domain.ReplicationRepo.
type Replication struct {
	pool *pgxpool.Pool
}

// NewReplication wraps a pool.
func NewReplication(pool *pgxpool.Pool) *Replication {
	return &Replication{pool: pool}
}

// FetchTable читает changed-rows из table с фильтром по cursor.
// Все три значения (table/cols/cursorCol) приходят из validated catalog,
// не из user input — SQL-инъекции нет.
func (r *Replication) FetchTable(ctx context.Context, userID uuid.UUID, table string, cursor time.Time, limit int) (domain.TableDelta, error) {
	cols := pullColumns[table]
	cursorCol := pullCursorColumn[table]
	if cols == "" || cursorCol == "" {
		return domain.TableDelta{}, fmt.Errorf("sync.Replication.FetchTable: %w: %q", domain.ErrUnknownTable, table)
	}

	q := fmt.Sprintf(
		`SELECT %s FROM %s
		  WHERE user_id = $1 AND %s > $2
		  ORDER BY %s ASC
		  LIMIT $3`,
		cols, table, cursorCol, cursorCol,
	)
	rows, err := r.pool.Query(ctx, q, userID, cursor, limit+1)
	if err != nil {
		return domain.TableDelta{}, fmt.Errorf("sync.Replication.FetchTable: query: %w", err)
	}
	defer rows.Close()

	out := make([]map[string]any, 0, limit)
	descs := rows.FieldDescriptions()
	var maxAt time.Time
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return domain.TableDelta{}, fmt.Errorf("sync.Replication.FetchTable: values: %w", err)
		}
		row := make(map[string]any, len(descs))
		for i, d := range descs {
			name := d.Name
			row[name] = NormalizeValue(vals[i])
			if name == cursorCol {
				if t, ok := vals[i].(time.Time); ok && t.After(maxAt) {
					maxAt = t
				}
			}
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return domain.TableDelta{}, fmt.Errorf("sync.Replication.FetchTable: rows: %w", err)
	}

	truncated := false
	if len(out) > limit {
		out = out[:limit]
		truncated = true
	}
	return domain.TableDelta{Table: table, Rows: out, MaxSeenAt: maxAt, Truncated: truncated}, nil
}

// FetchTombstones reads tombstones since cursor, excluding the requesting
// device's own deletions (NULL-safe via IS DISTINCT FROM).
func (r *Replication) FetchTombstones(ctx context.Context, userID, requestingDevice uuid.UUID, cursor time.Time, limit int) ([]domain.Tombstone, time.Time, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT table_name, row_id, deleted_at
		   FROM sync_tombstones
		  WHERE user_id = $1
		    AND deleted_at > $2
		    AND origin_device_id IS DISTINCT FROM $3
		  ORDER BY deleted_at ASC
		  LIMIT $4`,
		userID, cursor, requestingDevice, limit+1,
	)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("sync.Replication.FetchTombstones: query: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Tombstone, 0)
	var maxAt time.Time
	for rows.Next() {
		var (
			table string
			rowID uuid.UUID
			delAt time.Time
		)
		if err := rows.Scan(&table, &rowID, &delAt); err != nil {
			return nil, time.Time{}, fmt.Errorf("sync.Replication.FetchTombstones: scan: %w", err)
		}
		out = append(out, domain.Tombstone{Table: table, RowID: rowID, DeletedAt: delAt})
		if delAt.After(maxAt) {
			maxAt = delAt
		}
	}
	if err := rows.Err(); err != nil {
		return nil, time.Time{}, fmt.Errorf("sync.Replication.FetchTombstones: rows: %w", err)
	}
	return out, maxAt, nil
}

// ApplyDelete — TX: DELETE FROM table + INSERT into sync_tombstones with
// origin_device_id. Caller validated `table` against the catalog already.
func (r *Replication) ApplyDelete(ctx context.Context, userID, originDevice uuid.UUID, table string, rowID uuid.UUID) error {
	if _, ok := pullColumns[table]; !ok {
		return fmt.Errorf("sync.Replication.ApplyDelete: %w: %q", domain.ErrUnknownTable, table)
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("sync.Replication.ApplyDelete: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := fmt.Sprintf(`DELETE FROM %s WHERE id = $1 AND user_id = $2`, table)
	if _, err := tx.Exec(ctx, q, rowID, userID); err != nil {
		return fmt.Errorf("sync.Replication.ApplyDelete: delete: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO sync_tombstones (user_id, table_name, row_id, origin_device_id)
		 VALUES ($1, $2, $3, $4)`,
		userID, table, rowID, originDevice,
	); err != nil {
		return fmt.Errorf("sync.Replication.ApplyDelete: tombstone: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("sync.Replication.ApplyDelete: commit: %w", err)
	}
	return nil
}

// PruneTombstones deletes tombstones with deleted_at < cutoff. Returns the
// rows pruned (for logging).
func (r *Replication) PruneTombstones(ctx context.Context, cutoff time.Time) (int64, error) {
	cmd, err := r.pool.Exec(ctx,
		`DELETE FROM sync_tombstones WHERE deleted_at < $1`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("sync.Replication.PruneTombstones: %w", err)
	}
	return cmd.RowsAffected(), nil
}

// NormalizeValue приводит pgx Value -> JSON-safe representation.
// pgtype.* типы JSON-marshal'ятся плохо без преобразования; голые time/
// uuid/string/int/bool — как есть. Exposed so handlers can reuse if they
// build maps outside the repo.
func NormalizeValue(v any) any {
	switch t := v.(type) {
	case time.Time:
		return t.UTC().Format(time.RFC3339Nano)
	case [16]byte:
		u := uuid.UUID(t)
		return u.String()
	case nil:
		return nil
	default:
		return v
	}
}

var _ domain.ReplicationRepo = (*Replication)(nil)
