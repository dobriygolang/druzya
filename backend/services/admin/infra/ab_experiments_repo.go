// ab_experiments_repo.go — Admin Phase 2: pg adapter.
//
// Minimal: List / GetByID / Create / SetStatus. Variant rollout
// (ab_user_assignments) и stats — Phase 3 (отдельный сервис).
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"druz9/admin/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ABExperiments persistence adapter.
type ABExperiments struct {
	pool *pgxpool.Pool
}

// NewABExperiments wraps a pool.
func NewABExperiments(pool *pgxpool.Pool) *ABExperiments {
	return &ABExperiments{pool: pool}
}

// Compile-time check.
var _ domain.ABExperimentRepo = (*ABExperiments)(nil)

const abExperimentColumns = `id, slug, hypothesis, variants, metric_slug, status, starts_at, ends_at, created_by, created_at, updated_at`

// List returns experiments ordered by created_at desc.
func (r *ABExperiments) List(ctx context.Context) ([]domain.ABExperiment, error) {
	q := `SELECT ` + abExperimentColumns + ` FROM ab_experiments ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("ab_experiments.List: %w", err)
	}
	defer rows.Close()

	out := make([]domain.ABExperiment, 0, 8)
	for rows.Next() {
		e, err := scanABExperiment(rows)
		if err != nil {
			return nil, fmt.Errorf("ab_experiments.List.scan: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ab_experiments.List.rows: %w", err)
	}
	return out, nil
}

// GetByID returns one experiment; ErrNotFound when missing.
func (r *ABExperiments) GetByID(ctx context.Context, id uuid.UUID) (domain.ABExperiment, error) {
	q := `SELECT ` + abExperimentColumns + ` FROM ab_experiments WHERE id = $1`
	row := r.pool.QueryRow(ctx, q, id)
	out, err := scanABExperiment(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ABExperiment{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.ABExperiment{}, fmt.Errorf("ab_experiments.GetByID: %w", err)
	}
	return out, nil
}

// Create — INSERT + RETURNING. Maps unique-violation на slug to ErrConflict.
func (r *ABExperiments) Create(ctx context.Context, in domain.ABExperimentUpsert) (domain.ABExperiment, error) {
	variantsJSON, err := json.Marshal(in.Variants)
	if err != nil {
		return domain.ABExperiment{}, fmt.Errorf("ab_experiments.Create.marshal: %w", err)
	}
	status := in.Status
	if status == "" {
		status = domain.ABStatusDraft
	}
	q := `
		INSERT INTO ab_experiments (
			slug, hypothesis, variants, metric_slug, status, starts_at, ends_at, created_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING ` + abExperimentColumns

	row := r.pool.QueryRow(ctx, q,
		in.Slug, in.Hypothesis, variantsJSON, in.MetricSlug, status,
		in.StartsAt, in.EndsAt, in.CreatedBy,
	)
	out, err := scanABExperiment(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.ABExperiment{}, fmt.Errorf("%w: slug taken", domain.ErrConflict)
		}
		return domain.ABExperiment{}, fmt.Errorf("ab_experiments.Create: %w", err)
	}
	return out, nil
}

// SetStatus updates status field; returns the refreshed row.
func (r *ABExperiments) SetStatus(ctx context.Context, id uuid.UUID, status string) (domain.ABExperiment, error) {
	q := `
		UPDATE ab_experiments
		SET status = $1, updated_at = now()
		WHERE id = $2
		RETURNING ` + abExperimentColumns

	row := r.pool.QueryRow(ctx, q, status, id)
	out, err := scanABExperiment(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ABExperiment{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.ABExperiment{}, fmt.Errorf("ab_experiments.SetStatus: %w", err)
	}
	return out, nil
}

func scanABExperiment(row scannable) (domain.ABExperiment, error) {
	var (
		out     domain.ABExperiment
		raw     []byte
		creator *uuid.UUID
	)
	err := row.Scan(
		&out.ID, &out.Slug, &out.Hypothesis, &raw, &out.MetricSlug,
		&out.Status, &out.StartsAt, &out.EndsAt, &creator,
		&out.CreatedAt, &out.UpdatedAt,
	)
	if err != nil {
		return domain.ABExperiment{}, err
	}
	out.CreatedBy = creator
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out.Variants); err != nil {
			return domain.ABExperiment{}, fmt.Errorf("ab_experiments.scan.variants: %w", err)
		}
	}
	if out.Variants == nil {
		out.Variants = []domain.ABVariant{}
	}
	return out, nil
}
