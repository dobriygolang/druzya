package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/mock_interview/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Tasks struct{ pool *pgxpool.Pool }

func NewTasks(pool *pgxpool.Pool) *Tasks { return &Tasks{pool: pool} }

const taskCols = `id, stage_kind, language, difficulty, title, body_md,
	sample_io_md, reference_criteria, reference_solution_md,
	functional_requirements_md, time_limit_min, ai_strictness_profile_id,
	COALESCE(llm_model, ''), active, created_by_admin_id, created_at, updated_at`

func (r *Tasks) scanRow(row pgx.Row) (domain.MockTask, error) {
	var (
		id, profID, adminID                 pgtype.UUID
		stageKind, language                 string
		difficulty                          int16
		title, body, sample, refSol, funcRq string
		llmModel                            string
		refCrit                             []byte
		timeLimit                           int
		active                              bool
		createdAt, updatedAt                time.Time
	)
	err := row.Scan(&id, &stageKind, &language, &difficulty, &title, &body,
		&sample, &refCrit, &refSol, &funcRq, &timeLimit, &profID, &llmModel,
		&active, &adminID, &createdAt, &updatedAt)
	if err != nil {
		return domain.MockTask{}, fmt.Errorf("row.Scan mock_tasks: %w", err)
	}
	rc, err := scanReferenceCriteria(refCrit)
	if err != nil {
		return domain.MockTask{}, err
	}
	out := domain.MockTask{
		ID:                       sharedpg.UUIDFrom(id),
		StageKind:                domain.StageKind(stageKind),
		Language:                 domain.TaskLanguage(language),
		Difficulty:               int(difficulty),
		Title:                    title,
		BodyMD:                   body,
		SampleIOMD:               sample,
		ReferenceCriteria:        rc,
		ReferenceSolutionMD:      refSol,
		FunctionalRequirementsMD: funcRq,
		TimeLimitMin:             timeLimit,
		LLMModel:                 llmModel,
		Active:                   active,
		CreatedAt:                createdAt,
		UpdatedAt:                updatedAt,
	}
	if profID.Valid {
		v := sharedpg.UUIDFrom(profID)
		out.AIStrictnessProfileID = &v
	}
	if adminID.Valid {
		v := sharedpg.UUIDFrom(adminID)
		out.CreatedByAdminID = &v
	}
	return out, nil
}

func (r *Tasks) List(ctx context.Context, f domain.TaskFilter) ([]domain.MockTask, error) {
	q := `SELECT ` + taskCols + ` FROM mock_tasks WHERE 1=1`
	args := []any{}
	idx := 1
	if f.StageKind != "" {
		q += fmt.Sprintf(` AND stage_kind=$%d`, idx)
		args = append(args, string(f.StageKind))
		idx++
	}
	if f.Language != "" {
		q += fmt.Sprintf(` AND language=$%d`, idx)
		args = append(args, string(f.Language))
	}
	if f.OnlyActive {
		q += ` AND active = true`
	}
	q += ` ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("mock_interview.Tasks.List: %w", err)
	}
	defer rows.Close()
	var out []domain.MockTask
	for rows.Next() {
		t, err := r.scanRow(rows)
		if err != nil {
			return nil, fmt.Errorf("mock_interview.Tasks.List scan: %w", err)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err mock_tasks.list: %w", err)
	}
	return out, nil
}

func (r *Tasks) Get(ctx context.Context, id uuid.UUID) (domain.MockTask, error) {
	t, err := r.scanRow(r.pool.QueryRow(ctx,
		`SELECT `+taskCols+` FROM mock_tasks WHERE id=$1`, sharedpg.UUID(id)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.MockTask{}, domain.ErrNotFound
		}
		return domain.MockTask{}, fmt.Errorf("mock_interview.Tasks.Get: %w", err)
	}
	return t, nil
}

func (r *Tasks) Create(ctx context.Context, t domain.MockTask) (domain.MockTask, error) {
	rcBytes, err := marshalReferenceCriteria(t.ReferenceCriteria)
	if err != nil {
		return domain.MockTask{}, err
	}
	row := r.pool.QueryRow(ctx, `
		INSERT INTO mock_tasks (id, stage_kind, language, difficulty, title, body_md,
			sample_io_md, reference_criteria, reference_solution_md,
			functional_requirements_md, time_limit_min, ai_strictness_profile_id,
			llm_model, active, created_by_admin_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULLIF($13,''),$14,$15)
		RETURNING `+taskCols,
		sharedpg.UUID(t.ID), string(t.StageKind), string(t.Language), t.Difficulty,
		t.Title, t.BodyMD, t.SampleIOMD, rcBytes, t.ReferenceSolutionMD,
		t.FunctionalRequirementsMD, t.TimeLimitMin,
		nullableUUID(t.AIStrictnessProfileID), t.LLMModel, t.Active,
		nullableUUID(t.CreatedByAdminID))
	out, err := r.scanRow(row)
	if err != nil {
		return domain.MockTask{}, fmt.Errorf("mock_interview.Tasks.Create: %w", err)
	}
	return out, nil
}

func (r *Tasks) Update(ctx context.Context, t domain.MockTask) (domain.MockTask, error) {
	rcBytes, err := marshalReferenceCriteria(t.ReferenceCriteria)
	if err != nil {
		return domain.MockTask{}, err
	}
	row := r.pool.QueryRow(ctx, `
		UPDATE mock_tasks SET
			stage_kind=$2, language=$3, difficulty=$4, title=$5, body_md=$6,
			sample_io_md=$7, reference_criteria=$8, reference_solution_md=$9,
			functional_requirements_md=$10, time_limit_min=$11,
			ai_strictness_profile_id=$12, llm_model=NULLIF($13,''),
			active=$14, updated_at=now()
		WHERE id=$1
		RETURNING `+taskCols,
		sharedpg.UUID(t.ID), string(t.StageKind), string(t.Language), t.Difficulty,
		t.Title, t.BodyMD, t.SampleIOMD, rcBytes, t.ReferenceSolutionMD,
		t.FunctionalRequirementsMD, t.TimeLimitMin,
		nullableUUID(t.AIStrictnessProfileID), t.LLMModel, t.Active)
	out, err := r.scanRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.MockTask{}, domain.ErrNotFound
		}
		return domain.MockTask{}, fmt.Errorf("mock_interview.Tasks.Update: %w", err)
	}
	return out, nil
}

func (r *Tasks) SetActive(ctx context.Context, id uuid.UUID, active bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE mock_tasks SET active=$2, updated_at=now() WHERE id=$1`,
		sharedpg.UUID(id), active)
	if err != nil {
		return fmt.Errorf("mock_interview.Tasks.SetActive: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// PickRandom selects one random active task for the given stage_kind, with
// optional language_pool / task_pool_ids filters. Returns ErrNoTaskAvailable
// when nothing matches.
func (r *Tasks) PickRandom(ctx context.Context, stageKind domain.StageKind,
	languagePool []domain.TaskLanguage, taskPoolIDs []uuid.UUID,
) (domain.MockTask, error) {
	q := `SELECT ` + taskCols + ` FROM mock_tasks WHERE active = true AND stage_kind=$1`
	args := []any{string(stageKind)}
	idx := 2
	if len(languagePool) > 0 {
		langs := make([]string, len(languagePool))
		for i, l := range languagePool {
			langs[i] = string(l)
		}
		q += fmt.Sprintf(` AND language = ANY($%d)`, idx)
		args = append(args, langs)
		idx++
	}
	if len(taskPoolIDs) > 0 {
		ids := make([]pgtype.UUID, len(taskPoolIDs))
		for i, id := range taskPoolIDs {
			ids[i] = sharedpg.UUID(id)
		}
		q += fmt.Sprintf(` AND id = ANY($%d)`, idx)
		args = append(args, ids)
	}
	q += ` ORDER BY random() LIMIT 1`

	out, err := r.scanRow(r.pool.QueryRow(ctx, q, args...))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.MockTask{}, domain.ErrNoTaskAvailable
		}
		return domain.MockTask{}, fmt.Errorf("mock_interview.Tasks.PickRandom: %w", err)
	}
	return out, nil
}

// nullableUUID returns NULL for nil/uuid.Nil, the pgtype.UUID otherwise.
// Centralised here so all repos in this package treat *uuid.UUID the same.
func nullableUUID(p *uuid.UUID) any {
	if p == nil || *p == uuid.Nil {
		return nil
	}
	return sharedpg.UUID(*p)
}

var _ domain.TaskRepo = (*Tasks)(nil)
