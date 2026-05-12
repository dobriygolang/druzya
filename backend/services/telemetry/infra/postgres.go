// Package infra — pgx adapter for telemetry events + consent tables.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/telemetry/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.EventRepo + domain.ConsentRepo. Один pool на
// оба интерфейса — таблицы маленькие, hot path только InsertBatch.
type Postgres struct{ pool *pgxpool.Pool }

// NewPostgres wires the adapter.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	if pool == nil {
		panic("telemetry/infra.NewPostgres: nil pool")
	}
	return &Postgres{pool: pool}
}

// InsertBatch — single transaction, multi-row INSERT через pgx CopyFrom.
// CopyFrom избегает per-row round-trip; для batch >5 events это в 3-5x
// быстрее чем VALUES (...), (...). Для batch ≤5 разница незначительна, но
// CopyFrom ещё и lock-friendly.
func (r *Postgres) InsertBatch(ctx context.Context, events []domain.Event) (int, error) {
	if len(events) == 0 {
		return 0, nil
	}
	rows := make([][]any, 0, len(events))
	for _, ev := range events {
		propsJSON, err := json.Marshal(ev.Properties)
		if err != nil {
			// Если client прислал non-marshalable map — skip этот event,
			// не fail весь batch. Пути попадания такого event'а в repo нет
			// (UC уже sanitize'нул), но defensive guard.
			continue
		}
		rows = append(rows, []any{
			ev.ID,
			ev.UserID,
			string(ev.Surface),
			ev.Name,
			ev.OccurredAt,
			ev.ReceivedAt,
			propsJSON,
		})
	}
	if len(rows) == 0 {
		return 0, nil
	}
	n, err := r.pool.CopyFrom(
		ctx,
		pgx.Identifier{"telemetry_events"},
		[]string{"id", "user_id", "surface", "name", "occurred_at", "received_at", "properties"},
		pgx.CopyFromRows(rows),
	)
	if err != nil {
		return 0, fmt.Errorf("telemetry: copy from: %w", err)
	}
	return int(n), nil
}

// ListByUser — read для ExportEvents. Surface="" → все.
func (r *Postgres) ListByUser(ctx context.Context, userID uuid.UUID, surface domain.Surface) ([]domain.Event, error) {
	var (
		rows pgx.Rows
		err  error
	)
	if surface == "" {
		const q = `SELECT id, user_id, surface, name, occurred_at, received_at, properties
		           FROM telemetry_events
		           WHERE user_id = $1
		           ORDER BY occurred_at ASC`
		rows, err = r.pool.Query(ctx, q, userID)
	} else {
		const q = `SELECT id, user_id, surface, name, occurred_at, received_at, properties
		           FROM telemetry_events
		           WHERE user_id = $1 AND surface = $2
		           ORDER BY occurred_at ASC`
		rows, err = r.pool.Query(ctx, q, userID, string(surface))
	}
	if err != nil {
		return nil, fmt.Errorf("telemetry: list by user: %w", err)
	}
	defer rows.Close()

	out := make([]domain.Event, 0, 256)
	for rows.Next() {
		var e domain.Event
		var s string
		var propsRaw []byte
		if err := rows.Scan(&e.ID, &e.UserID, &s, &e.Name, &e.OccurredAt, &e.ReceivedAt, &propsRaw); err != nil {
			return nil, fmt.Errorf("telemetry: scan: %w", err)
		}
		e.Surface = domain.Surface(s)
		if len(propsRaw) > 0 {
			_ = json.Unmarshal(propsRaw, &e.Properties)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("telemetry: rows: %w", err)
	}
	return out, nil
}

// DeleteByUser — GDPR pass. Surface="" → все.
func (r *Postgres) DeleteByUser(ctx context.Context, userID uuid.UUID, surface domain.Surface) (int, error) {
	var (
		tag pgconn.CommandTag
		err error
	)
	if surface == "" {
		const q = `DELETE FROM telemetry_events WHERE user_id = $1`
		tag, err = r.pool.Exec(ctx, q, userID)
	} else {
		const q = `DELETE FROM telemetry_events WHERE user_id = $1 AND surface = $2`
		tag, err = r.pool.Exec(ctx, q, userID, string(surface))
	}
	if err != nil {
		return 0, fmt.Errorf("telemetry: delete: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// ── Consent ────────────────────────────────────────────────────────────

// Get — single row lookup. Returns ok=false когда row отсутствует.
func (r *Postgres) Get(ctx context.Context, userID uuid.UUID, surface domain.Surface) (domain.Consent, bool, error) {
	const q = `SELECT user_id, surface, opted_in, consent_version, updated_at
	           FROM telemetry_consent
	           WHERE user_id = $1 AND surface = $2`
	row := r.pool.QueryRow(ctx, q, userID, string(surface))
	var c domain.Consent
	var s string
	if err := row.Scan(&c.UserID, &s, &c.OptedIn, &c.ConsentVersion, &c.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Consent{}, false, nil
		}
		return domain.Consent{}, false, fmt.Errorf("telemetry: consent get: %w", err)
	}
	c.Surface = domain.Surface(s)
	return c, true, nil
}

// Upsert — INSERT … ON CONFLICT DO UPDATE.
func (r *Postgres) Upsert(ctx context.Context, c domain.Consent) error {
	if c.UpdatedAt.IsZero() {
		c.UpdatedAt = time.Now().UTC()
	}
	const q = `INSERT INTO telemetry_consent (user_id, surface, opted_in, consent_version, updated_at)
	           VALUES ($1, $2, $3, $4, $5)
	           ON CONFLICT (user_id, surface) DO UPDATE
	           SET opted_in = EXCLUDED.opted_in,
	               consent_version = EXCLUDED.consent_version,
	               updated_at = EXCLUDED.updated_at`
	_, err := r.pool.Exec(ctx, q, c.UserID, string(c.Surface), c.OptedIn, c.ConsentVersion, c.UpdatedAt)
	if err != nil {
		return fmt.Errorf("telemetry: consent upsert: %w", err)
	}
	return nil
}

