// coach_prompts_repo.go — Admin Phase 2: coach_prompts pg adapter.
//
// Same shape pattern как goal_presets_repo: direct pgx, dynamic-SET update,
// unique-violation maps to ErrConflict. variables stored as JSONB.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"druz9/admin/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CoachPrompts persistence adapter.
type CoachPrompts struct {
	pool *pgxpool.Pool
}

// NewCoachPrompts wraps a pool.
func NewCoachPrompts(pool *pgxpool.Pool) *CoachPrompts {
	return &CoachPrompts{pool: pool}
}

// Compile-time check.
var _ domain.CoachPromptRepo = (*CoachPrompts)(nil)

const coachPromptColumns = `id, slug, category, template, variables, description, is_active, version, created_by, created_at, updated_at`

// List returns prompts ordered by category, slug.
func (r *CoachPrompts) List(ctx context.Context, activeOnly bool) ([]domain.CoachPrompt, error) {
	q := `SELECT ` + coachPromptColumns + ` FROM coach_prompts`
	if activeOnly {
		q += ` WHERE is_active = TRUE`
	}
	q += ` ORDER BY category ASC, slug ASC`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("coach_prompts.List: %w", err)
	}
	defer rows.Close()

	out := make([]domain.CoachPrompt, 0, 8)
	for rows.Next() {
		p, err := scanCoachPrompt(rows)
		if err != nil {
			return nil, fmt.Errorf("coach_prompts.List.scan: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("coach_prompts.List.rows: %w", err)
	}
	return out, nil
}

// GetByID returns one prompt; ErrNotFound when missing.
func (r *CoachPrompts) GetByID(ctx context.Context, id uuid.UUID) (domain.CoachPrompt, error) {
	q := `SELECT ` + coachPromptColumns + ` FROM coach_prompts WHERE id = $1`
	row := r.pool.QueryRow(ctx, q, id)
	out, err := scanCoachPrompt(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.CoachPrompt{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.CoachPrompt{}, fmt.Errorf("coach_prompts.GetByID: %w", err)
	}
	return out, nil
}

// Create — INSERT + RETURNING.
func (r *CoachPrompts) Create(ctx context.Context, in domain.CoachPromptUpsert) (domain.CoachPrompt, error) {
	vars := in.Variables
	if vars == nil {
		vars = []string{}
	}
	varsJSON, err := json.Marshal(vars)
	if err != nil {
		return domain.CoachPrompt{}, fmt.Errorf("coach_prompts.Create.marshal: %w", err)
	}

	q := `
		INSERT INTO coach_prompts (slug, category, template, variables, description, is_active, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING ` + coachPromptColumns

	row := r.pool.QueryRow(ctx, q,
		in.Slug, in.Category, in.Template, varsJSON, in.Description, in.IsActive, in.CreatedBy,
	)
	out, err := scanCoachPrompt(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.CoachPrompt{}, fmt.Errorf("%w: slug taken", domain.ErrConflict)
		}
		return domain.CoachPrompt{}, fmt.Errorf("coach_prompts.Create: %w", err)
	}
	return out, nil
}

// Update — dynamic SET; version always bumps.
func (r *CoachPrompts) Update(ctx context.Context, id uuid.UUID, in domain.CoachPromptPatch) (domain.CoachPrompt, error) {
	sets := []string{"updated_at = now()", "version = version + 1"}
	args := []any{}
	idx := 1
	add := func(col string, val any) {
		sets = append(sets, fmt.Sprintf("%s = $%d", col, idx))
		args = append(args, val)
		idx++
	}
	if in.Category != nil {
		add("category", *in.Category)
	}
	if in.Template != nil {
		add("template", *in.Template)
	}
	if in.Variables != nil {
		vars := *in.Variables
		if vars == nil {
			vars = []string{}
		}
		raw, err := json.Marshal(vars)
		if err != nil {
			return domain.CoachPrompt{}, fmt.Errorf("coach_prompts.Update.marshal: %w", err)
		}
		add("variables", raw)
	}
	if in.Description != nil {
		add("description", *in.Description)
	}
	if in.IsActive != nil {
		add("is_active", *in.IsActive)
	}

	args = append(args, id)
	q := fmt.Sprintf(
		`UPDATE coach_prompts SET %s WHERE id = $%d RETURNING %s`,
		strings.Join(sets, ", "), idx, coachPromptColumns,
	)

	row := r.pool.QueryRow(ctx, q, args...)
	out, err := scanCoachPrompt(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.CoachPrompt{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.CoachPrompt{}, fmt.Errorf("coach_prompts.Update: %w", err)
	}
	return out, nil
}

// Deactivate — soft delete (also bumps version).
func (r *CoachPrompts) Deactivate(ctx context.Context, id uuid.UUID) error {
	const q = `UPDATE coach_prompts SET is_active = FALSE, version = version + 1, updated_at = now() WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, id)
	if err != nil {
		return fmt.Errorf("coach_prompts.Deactivate: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func scanCoachPrompt(row scannable) (domain.CoachPrompt, error) {
	var (
		out     domain.CoachPrompt
		raw     []byte
		creator *uuid.UUID
	)
	err := row.Scan(
		&out.ID, &out.Slug, &out.Category, &out.Template, &raw,
		&out.Description, &out.IsActive, &out.Version, &creator,
		&out.CreatedAt, &out.UpdatedAt,
	)
	if err != nil {
		return domain.CoachPrompt{}, err
	}
	out.CreatedBy = creator
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out.Variables); err != nil {
			return domain.CoachPrompt{}, fmt.Errorf("coach_prompts.scan.variables: %w", err)
		}
	}
	if out.Variables == nil {
		out.Variables = []string{}
	}
	return out, nil
}
