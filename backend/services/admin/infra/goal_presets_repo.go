// goal_presets_repo.go — goal_presets pg adapter.
//
// Не используем sqlc — таблица маленькая, queries прямолинейные, и
// admin/infra/queries/admin.sql растёт медленно. Conventionally drop into
// admin.sql если станет нужен strict-typed surface.
package infra

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"druz9/admin/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GoalPresets is the persistence adapter for the goal_presets table.
type GoalPresets struct {
	pool *pgxpool.Pool
}

// NewGoalPresets wraps a pool.
func NewGoalPresets(pool *pgxpool.Pool) *GoalPresets {
	return &GoalPresets{pool: pool}
}

// Compile-time check.
var _ domain.GoalPresetRepo = (*GoalPresets)(nil)

// List returns presets ordered by sort_order ASC, then title.
func (r *GoalPresets) List(ctx context.Context, activeOnly bool) ([]domain.GoalPreset, error) {
	q := `
		SELECT id, slug, title, kind, target_company, target_level, target_text,
		       default_target_days, is_active, sort_order, created_by, created_at, updated_at
		FROM goal_presets
	`
	if activeOnly {
		q += ` WHERE is_active = TRUE`
	}
	q += ` ORDER BY sort_order ASC, title ASC`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("goal_presets.List: %w", err)
	}
	defer rows.Close()

	out := make([]domain.GoalPreset, 0, 8)
	for rows.Next() {
		p, err := scanGoalPreset(rows)
		if err != nil {
			return nil, fmt.Errorf("goal_presets.List.scan: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("goal_presets.List.rows: %w", err)
	}
	return out, nil
}

// GetByID returns one preset; ErrNotFound when missing.
func (r *GoalPresets) GetByID(ctx context.Context, id uuid.UUID) (domain.GoalPreset, error) {
	const q = `
		SELECT id, slug, title, kind, target_company, target_level, target_text,
		       default_target_days, is_active, sort_order, created_by, created_at, updated_at
		FROM goal_presets WHERE id = $1
	`
	row := r.pool.QueryRow(ctx, q, id)
	out, err := scanGoalPreset(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.GoalPreset{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.GoalPreset{}, fmt.Errorf("goal_presets.GetByID: %w", err)
	}
	return out, nil
}

// GetBySlug — same as GetByID but slug-lookup.
func (r *GoalPresets) GetBySlug(ctx context.Context, slug string) (domain.GoalPreset, error) {
	const q = `
		SELECT id, slug, title, kind, target_company, target_level, target_text,
		       default_target_days, is_active, sort_order, created_by, created_at, updated_at
		FROM goal_presets WHERE slug = $1
	`
	row := r.pool.QueryRow(ctx, q, slug)
	out, err := scanGoalPreset(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.GoalPreset{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.GoalPreset{}, fmt.Errorf("goal_presets.GetBySlug: %w", err)
	}
	return out, nil
}

// Create — INSERT + RETURNING. Maps pg unique-violation → ErrConflict.
func (r *GoalPresets) Create(ctx context.Context, in domain.GoalPresetUpsert) (domain.GoalPreset, error) {
	const q = `
		INSERT INTO goal_presets (
			slug, title, kind, target_company, target_level, target_text,
			default_target_days, is_active, sort_order, created_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, slug, title, kind, target_company, target_level, target_text,
		          default_target_days, is_active, sort_order, created_by, created_at, updated_at
	`
	row := r.pool.QueryRow(ctx, q,
		in.Slug, in.Title, in.Kind, in.TargetCompany, in.TargetLevel, in.TargetText,
		in.DefaultTargetDays, in.IsActive, in.SortOrder, in.CreatedBy,
	)
	out, err := scanGoalPreset(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
			return domain.GoalPreset{}, fmt.Errorf("%w: slug taken", domain.ErrConflict)
		}
		return domain.GoalPreset{}, fmt.Errorf("goal_presets.Create: %w", err)
	}
	return out, nil
}

// Update — partial-patch via dynamically built SET. Nil-pointer fields are
// skipped. DefaultTargetDays == -1 means "clear to NULL".
func (r *GoalPresets) Update(ctx context.Context, id uuid.UUID, in domain.GoalPresetPatch) (domain.GoalPreset, error) {
	sets := []string{"updated_at = now()"}
	args := []any{}
	idx := 1
	add := func(col string, val any) {
		sets = append(sets, fmt.Sprintf("%s = $%d", col, idx))
		args = append(args, val)
		idx++
	}
	if in.Title != nil {
		add("title", *in.Title)
	}
	if in.Kind != nil {
		add("kind", *in.Kind)
	}
	if in.TargetCompany != nil {
		add("target_company", *in.TargetCompany)
	}
	if in.TargetLevel != nil {
		add("target_level", *in.TargetLevel)
	}
	if in.TargetText != nil {
		add("target_text", *in.TargetText)
	}
	if in.DefaultTargetDays != nil {
		if *in.DefaultTargetDays < 0 {
			add("default_target_days", nil)
		} else {
			add("default_target_days", *in.DefaultTargetDays)
		}
	}
	if in.IsActive != nil {
		add("is_active", *in.IsActive)
	}
	if in.SortOrder != nil {
		add("sort_order", *in.SortOrder)
	}

	args = append(args, id)
	q := fmt.Sprintf(`
		UPDATE goal_presets SET %s WHERE id = $%d
		RETURNING id, slug, title, kind, target_company, target_level, target_text,
		          default_target_days, is_active, sort_order, created_by, created_at, updated_at
	`, strings.Join(sets, ", "), idx)

	row := r.pool.QueryRow(ctx, q, args...)
	out, err := scanGoalPreset(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.GoalPreset{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.GoalPreset{}, fmt.Errorf("goal_presets.Update: %w", err)
	}
	return out, nil
}

// Deactivate — soft delete (is_active=false).
func (r *GoalPresets) Deactivate(ctx context.Context, id uuid.UUID) error {
	const q = `UPDATE goal_presets SET is_active = FALSE, updated_at = now() WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, id)
	if err != nil {
		return fmt.Errorf("goal_presets.Deactivate: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// scannable — interface over *pgx.Row + pgx.Rows so scan logic lives in
// one place.
type scannable interface {
	Scan(dest ...any) error
}

func scanGoalPreset(row scannable) (domain.GoalPreset, error) {
	var (
		out     domain.GoalPreset
		days    *int
		creator *uuid.UUID
	)
	err := row.Scan(
		&out.ID, &out.Slug, &out.Title, &out.Kind,
		&out.TargetCompany, &out.TargetLevel, &out.TargetText,
		&days, &out.IsActive, &out.SortOrder, &creator,
		&out.CreatedAt, &out.UpdatedAt,
	)
	if err != nil {
		return domain.GoalPreset{}, err
	}
	out.DefaultTargetDays = days
	out.CreatedBy = creator
	return out, nil
}
