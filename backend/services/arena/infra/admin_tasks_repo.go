package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/arena/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminTasks implements domain.AdminTaskRepo via direct pgx queries against
// the canonical `tasks` table (00003_content.sql). SQL is verbatim from the
// pre-refactor monolith handler so wire-format/edge-cases stay identical.
type AdminTasks struct {
	pool *pgxpool.Pool
}

// NewAdminTasks wraps a pool.
func NewAdminTasks(pool *pgxpool.Pool) *AdminTasks {
	return &AdminTasks{pool: pool}
}

const arenaAdminTaskCols = `id, slug, title_ru, title_en, description_ru, description_en,
		difficulty, section, time_limit_sec, memory_limit_mb,
		COALESCE(solution_hint,''), version, is_active, COALESCE(avg_rating,0)`

func scanAdminTask(row pgx.Row) (domain.AdminTask, error) {
	var d domain.AdminTask
	var idUUID uuid.UUID
	err := row.Scan(&idUUID, &d.Slug, &d.TitleRU, &d.TitleEN,
		&d.DescriptionRU, &d.DescriptionEN, &d.Difficulty, &d.Section,
		&d.TimeLimitSec, &d.MemoryLimitMB, &d.SolutionHint,
		&d.Version, &d.IsActive, &d.AvgRating)
	if err != nil {
		return domain.AdminTask{}, fmt.Errorf("scan admin task: %w", err)
	}
	d.ID = idUUID
	return d, nil
}

// List returns tasks ordered by created_at DESC matching the filter.
func (a *AdminTasks) List(ctx context.Context, f domain.AdminTaskListFilter) ([]domain.AdminTask, error) {
	args := []any{}
	idx := 1
	sql := `SELECT ` + arenaAdminTaskCols + ` FROM tasks WHERE 1=1`
	if f.Section != "" {
		sql += fmt.Sprintf(" AND section = $%d", idx)
		args = append(args, f.Section)
		idx++
	}
	if f.Difficulty != "" {
		sql += fmt.Sprintf(" AND difficulty = $%d", idx)
		args = append(args, f.Difficulty)
		idx++
	}
	if f.OnlyActive {
		sql += " AND is_active = TRUE"
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 200
	}
	sql += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", idx)
	args = append(args, limit)

	rows, err := a.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("arena.AdminTasks.List: %w", err)
	}
	defer rows.Close()
	out := make([]domain.AdminTask, 0)
	for rows.Next() {
		t, scanErr := scanAdminTask(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("arena.AdminTasks.List: scan: %w", scanErr)
		}
		out = append(out, t)
	}
	return out, nil
}

// Get loads a single task or returns domain.ErrNotFound.
func (a *AdminTasks) Get(ctx context.Context, id uuid.UUID) (domain.AdminTask, error) {
	row := a.pool.QueryRow(ctx,
		`SELECT `+arenaAdminTaskCols+` FROM tasks WHERE id = $1`, sharedpg.UUID(id))
	t, err := scanAdminTask(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AdminTask{}, domain.ErrNotFound
		}
		return domain.AdminTask{}, fmt.Errorf("arena.AdminTasks.Get: %w", err)
	}
	return t, nil
}

// Create inserts a new task row and returns the resulting projection.
func (a *AdminTasks) Create(ctx context.Context, in domain.AdminTaskUpsert) (domain.AdminTask, error) {
	row := a.pool.QueryRow(ctx, `
			INSERT INTO tasks (slug, title_ru, title_en, description_ru, description_en,
				difficulty, section, time_limit_sec, memory_limit_mb, solution_hint, is_active)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''),$11)
			RETURNING `+arenaAdminTaskCols,
		in.Slug, in.TitleRU, in.TitleEN, in.DescriptionRU, in.DescriptionEN,
		in.Difficulty, in.Section, in.TimeLimitSec, in.MemoryLimitMB,
		in.SolutionHint, in.IsActive)
	t, err := scanAdminTask(row)
	if err != nil {
		return domain.AdminTask{}, fmt.Errorf("arena.AdminTasks.Create: %w", err)
	}
	return t, nil
}

// Update rewrites the row identified by id.
func (a *AdminTasks) Update(ctx context.Context, id uuid.UUID, in domain.AdminTaskUpsert) (domain.AdminTask, error) {
	row := a.pool.QueryRow(ctx, `
			UPDATE tasks SET
				slug=$2, title_ru=$3, title_en=$4, description_ru=$5, description_en=$6,
				difficulty=$7, section=$8, time_limit_sec=$9, memory_limit_mb=$10,
				solution_hint=NULLIF($11,''), is_active=$12, updated_at=now()
			WHERE id = $1
			RETURNING `+arenaAdminTaskCols,
		sharedpg.UUID(id), in.Slug, in.TitleRU, in.TitleEN,
		in.DescriptionRU, in.DescriptionEN, in.Difficulty, in.Section,
		in.TimeLimitSec, in.MemoryLimitMB, in.SolutionHint, in.IsActive)
	t, err := scanAdminTask(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AdminTask{}, domain.ErrNotFound
		}
		return domain.AdminTask{}, fmt.Errorf("arena.AdminTasks.Update: %w", err)
	}
	return t, nil
}

// SetActive flips is_active without touching anything else.
func (a *AdminTasks) SetActive(ctx context.Context, id uuid.UUID, active bool) error {
	tag, err := a.pool.Exec(ctx,
		`UPDATE tasks SET is_active = $2, updated_at = now() WHERE id = $1`,
		sharedpg.UUID(id), active)
	if err != nil {
		return fmt.Errorf("arena.AdminTasks.SetActive: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// Delete removes a task. FK violations from match_history bubble up and the
// caller maps them to HTTP 409.
func (a *AdminTasks) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := a.pool.Exec(ctx, `DELETE FROM tasks WHERE id = $1`, sharedpg.UUID(id))
	if err != nil {
		return fmt.Errorf("arena.AdminTasks.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
