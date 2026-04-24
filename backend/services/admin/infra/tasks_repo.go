package infra

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"druz9/admin/domain"
	admindb "druz9/admin/infra/db"
	"druz9/shared/enums"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────

// Tasks is the persistence adapter for the tasks aggregate (tasks +
// test_cases + task_templates + follow_up_questions). Writes are transactional.
type Tasks struct {
	pool *pgxpool.Pool
	q    *admindb.Queries
}

// NewTasks wraps a pool.
func NewTasks(pool *pgxpool.Pool) *Tasks {
	return &Tasks{pool: pool, q: admindb.New(pool)}
}

// List returns a filtered page of tasks plus the matching-total count.
//
// NOTE: the WHERE clause depends on which filters the caller provided, and
// sqlc cannot easily model optional predicates. We compose SQL by hand. Every
// user-supplied value is routed through positional binds.
func (t *Tasks) List(ctx context.Context, f domain.TaskFilter) (domain.TaskPage, error) {
	var (
		clauses []string
		args    []any
	)
	argPos := func() string { return fmt.Sprintf("$%d", len(args)+1) }

	if f.Section != nil && *f.Section != "" {
		clauses = append(clauses, "section = "+argPos())
		args = append(args, string(*f.Section))
	}
	if f.Difficulty != nil && *f.Difficulty != "" {
		clauses = append(clauses, "difficulty = "+argPos())
		args = append(args, string(*f.Difficulty))
	}
	if f.IsActive != nil {
		clauses = append(clauses, "is_active = "+argPos())
		args = append(args, *f.IsActive)
	}

	where := ""
	if len(clauses) > 0 {
		where = " WHERE " + strings.Join(clauses, " AND ")
	}

	limit := f.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}
	page := f.Page
	if page <= 0 {
		page = defaultListPage
	}
	offset := (page - 1) * limit

	// Count
	countSQL := "SELECT COUNT(*)::bigint FROM tasks" + where
	var total int64
	if err := t.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return domain.TaskPage{}, fmt.Errorf("admin.Tasks.List: count: %w", err)
	}

	// Data
	listSQL := `SELECT id, slug, title_ru, title_en, description_ru, description_en,
                       difficulty, section, time_limit_sec, memory_limit_mb,
                       solution_hint, version, is_active, created_at, updated_at
                  FROM tasks` + where +
		fmt.Sprintf(" ORDER BY created_at DESC LIMIT %d OFFSET %d", limit, offset)

	rows, err := t.pool.Query(ctx, listSQL, args...)
	if err != nil {
		return domain.TaskPage{}, fmt.Errorf("admin.Tasks.List: query: %w", err)
	}
	defer rows.Close()

	out := make([]domain.AdminTask, 0)
	for rows.Next() {
		var r taskRow
		if err := rows.Scan(
			&r.ID, &r.Slug, &r.TitleRu, &r.TitleEn,
			&r.DescriptionRu, &r.DescriptionEn,
			&r.Difficulty, &r.Section, &r.TimeLimitSec, &r.MemoryLimitMb,
			&r.SolutionHint, &r.Version, &r.IsActive, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return domain.TaskPage{}, fmt.Errorf("admin.Tasks.List: scan: %w", err)
		}
		out = append(out, taskFromRow(r))
	}
	if err := rows.Err(); err != nil {
		return domain.TaskPage{}, fmt.Errorf("admin.Tasks.List: rows: %w", err)
	}
	return domain.TaskPage{Items: out, Total: int(total), Page: page}, nil
}

// GetByID fetches a task plus its nested collections (test cases, templates,
// follow-up questions). Returns ErrNotFound when the row is missing.
func (t *Tasks) GetByID(ctx context.Context, id uuid.UUID) (domain.AdminTask, error) {
	row, err := t.q.GetTaskByID(ctx, sharedpg.UUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AdminTask{}, fmt.Errorf("admin.Tasks.GetByID: %w", domain.ErrNotFound)
		}
		return domain.AdminTask{}, fmt.Errorf("admin.Tasks.GetByID: %w", err)
	}
	return t.hydrate(ctx, t.q, taskRow{
		ID: row.ID, Slug: row.Slug, TitleRu: row.TitleRu, TitleEn: row.TitleEn,
		DescriptionRu: row.DescriptionRu, DescriptionEn: row.DescriptionEn,
		Difficulty: row.Difficulty, Section: row.Section,
		TimeLimitSec: row.TimeLimitSec, MemoryLimitMb: row.MemoryLimitMb,
		SolutionHint: row.SolutionHint, Version: row.Version, IsActive: row.IsActive,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	})
}

// Create inserts a new task + its nested rows in a single transaction.
func (t *Tasks) Create(ctx context.Context, in domain.TaskUpsert) (domain.AdminTask, error) {
	var out domain.AdminTask
	err := pgx.BeginFunc(ctx, t.pool, func(tx pgx.Tx) error {
		q := t.q.WithTx(tx)
		row, err := q.CreateTask(ctx, admindb.CreateTaskParams{
			Slug:          in.Slug,
			TitleRu:       in.TitleRU,
			TitleEn:       in.TitleEN,
			DescriptionRu: in.DescriptionRU,
			DescriptionEn: in.DescriptionEN,
			Difficulty:    string(in.Difficulty),
			Section:       string(in.Section),
			TimeLimitSec:  int32(in.TimeLimitSec),
			MemoryLimitMb: int32(in.MemoryLimitMB),
			SolutionHint:  pgText(in.SolutionHint),
			IsActive:      in.IsActive,
		})
		if err != nil {
			return mapUniqueErr(err)
		}
		taskID := sharedpg.UUIDFrom(row.ID)
		if err := insertChildren(ctx, q, row.ID, in); err != nil {
			return err
		}
		out = domain.AdminTask{
			ID: taskID, Slug: row.Slug, TitleRU: row.TitleRu, TitleEN: row.TitleEn,
			DescriptionRU: row.DescriptionRu, DescriptionEN: row.DescriptionEn,
			Difficulty: enums.Difficulty(row.Difficulty), Section: enums.Section(row.Section),
			TimeLimitSec: int(row.TimeLimitSec), MemoryLimitMB: int(row.MemoryLimitMb),
			SolutionHint: row.SolutionHint.String, Version: int(row.Version), IsActive: row.IsActive,
			CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
		}
		return t.fillChildren(ctx, q, taskID, &out)
	})
	if err != nil {
		return domain.AdminTask{}, fmt.Errorf("admin.Tasks.Create: %w", err)
	}
	return out, nil
}

// Update refreshes a task + its nested rows (children are replaced en bloc).
func (t *Tasks) Update(ctx context.Context, id uuid.UUID, in domain.TaskUpsert) (domain.AdminTask, error) {
	var out domain.AdminTask
	err := pgx.BeginFunc(ctx, t.pool, func(tx pgx.Tx) error {
		q := t.q.WithTx(tx)
		row, err := q.UpdateTask(ctx, admindb.UpdateTaskParams{
			ID:            sharedpg.UUID(id),
			Slug:          in.Slug,
			TitleRu:       in.TitleRU,
			TitleEn:       in.TitleEN,
			DescriptionRu: in.DescriptionRU,
			DescriptionEn: in.DescriptionEN,
			Difficulty:    string(in.Difficulty),
			Section:       string(in.Section),
			TimeLimitSec:  int32(in.TimeLimitSec),
			MemoryLimitMb: int32(in.MemoryLimitMB),
			SolutionHint:  pgText(in.SolutionHint),
			IsActive:      in.IsActive,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return domain.ErrNotFound
			}
			return mapUniqueErr(err)
		}
		if err := q.DeleteTestCases(ctx, row.ID); err != nil {
			return fmt.Errorf("delete test_cases: %w", err)
		}
		if err := q.DeleteTaskTemplates(ctx, row.ID); err != nil {
			return fmt.Errorf("delete task_templates: %w", err)
		}
		if err := q.DeleteFollowUpQuestions(ctx, row.ID); err != nil {
			return fmt.Errorf("delete follow_up_questions: %w", err)
		}
		if err := insertChildren(ctx, q, row.ID, in); err != nil {
			return err
		}
		taskID := sharedpg.UUIDFrom(row.ID)
		out = domain.AdminTask{
			ID: taskID, Slug: row.Slug, TitleRU: row.TitleRu, TitleEN: row.TitleEn,
			DescriptionRU: row.DescriptionRu, DescriptionEN: row.DescriptionEn,
			Difficulty: enums.Difficulty(row.Difficulty), Section: enums.Section(row.Section),
			TimeLimitSec: int(row.TimeLimitSec), MemoryLimitMB: int(row.MemoryLimitMb),
			SolutionHint: row.SolutionHint.String, Version: int(row.Version), IsActive: row.IsActive,
			CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
		}
		return t.fillChildren(ctx, q, taskID, &out)
	})
	if err != nil {
		return domain.AdminTask{}, fmt.Errorf("admin.Tasks.Update: %w", err)
	}
	return out, nil
}

// hydrate loads the child collections for a task row.
func (t *Tasks) hydrate(ctx context.Context, q *admindb.Queries, r taskRow) (domain.AdminTask, error) {
	id := sharedpg.UUIDFrom(r.ID)
	out := taskFromRow(r)
	if err := t.fillChildren(ctx, q, id, &out); err != nil {
		return domain.AdminTask{}, fmt.Errorf("admin.Tasks.hydrate: %w", err)
	}
	return out, nil
}

func (t *Tasks) fillChildren(ctx context.Context, q *admindb.Queries, id uuid.UUID, out *domain.AdminTask) error {
	tcRows, err := q.ListTestCases(ctx, sharedpg.UUID(id))
	if err != nil {
		return fmt.Errorf("list test_cases: %w", err)
	}
	out.TestCases = make([]domain.TestCase, 0, len(tcRows))
	for _, r := range tcRows {
		out.TestCases = append(out.TestCases, domain.TestCase{
			ID:             sharedpg.UUIDFrom(r.ID),
			Input:          r.Input,
			ExpectedOutput: r.ExpectedOutput,
			IsHidden:       r.IsHidden,
			OrderNum:       int(r.OrderNum),
		})
	}
	tplRows, err := q.ListTaskTemplates(ctx, sharedpg.UUID(id))
	if err != nil {
		return fmt.Errorf("list task_templates: %w", err)
	}
	out.Templates = make([]domain.TaskTemplate, 0, len(tplRows))
	for _, r := range tplRows {
		out.Templates = append(out.Templates, domain.TaskTemplate{
			Language:    enums.Language(r.Language),
			StarterCode: r.StarterCode,
		})
	}
	fqRows, err := q.ListFollowUpQuestions(ctx, sharedpg.UUID(id))
	if err != nil {
		return fmt.Errorf("list follow_up_questions: %w", err)
	}
	out.FollowUpQuestions = make([]domain.FollowUpQuestion, 0, len(fqRows))
	for _, r := range fqRows {
		out.FollowUpQuestions = append(out.FollowUpQuestions, domain.FollowUpQuestion{
			ID:         sharedpg.UUIDFrom(r.ID),
			QuestionRU: r.QuestionRu,
			QuestionEN: r.QuestionEn,
			AnswerHint: r.AnswerHint.String,
			OrderNum:   int(r.OrderNum),
		})
	}
	return nil
}

// insertChildren inserts every nested row for the given task. Must run inside
// a transaction (q bound to a pgx.Tx).
func insertChildren(ctx context.Context, q *admindb.Queries, taskID pgtype.UUID, in domain.TaskUpsert) error {
	for i, tc := range in.TestCases {
		if _, err := q.InsertTestCase(ctx, admindb.InsertTestCaseParams{
			TaskID:         taskID,
			Input:          tc.Input,
			ExpectedOutput: tc.ExpectedOutput,
			IsHidden:       tc.IsHidden,
			OrderNum:       int32(tc.OrderNum),
		}); err != nil {
			return fmt.Errorf("insert test_cases[%d]: %w", i, err)
		}
	}
	for i, tpl := range in.Templates {
		if err := q.UpsertTaskTemplate(ctx, admindb.UpsertTaskTemplateParams{
			TaskID:      taskID,
			Language:    string(tpl.Language),
			StarterCode: tpl.StarterCode,
		}); err != nil {
			return fmt.Errorf("upsert task_templates[%d]: %w", i, err)
		}
	}
	for i, fq := range in.FollowUpQuestions {
		if _, err := q.InsertFollowUpQuestion(ctx, admindb.InsertFollowUpQuestionParams{
			TaskID:     taskID,
			QuestionRu: fq.QuestionRU,
			QuestionEn: fq.QuestionEN,
			AnswerHint: pgText(fq.AnswerHint),
			OrderNum:   int32(fq.OrderNum),
		}); err != nil {
			return fmt.Errorf("insert follow_up_questions[%d]: %w", i, err)
		}
	}
	return nil
}

// taskRow is the hand-rolled scan target for the task listing. Mirrors the
// SELECT column order in List / GetByID.
type taskRow struct {
	ID            pgtype.UUID
	Slug          string
	TitleRu       string
	TitleEn       string
	DescriptionRu string
	DescriptionEn string
	Difficulty    string
	Section       string
	TimeLimitSec  int32
	MemoryLimitMb int32
	SolutionHint  pgtype.Text
	Version       int32
	IsActive      bool
	CreatedAt     pgtype.Timestamptz
	UpdatedAt     pgtype.Timestamptz
}

func taskFromRow(r taskRow) domain.AdminTask {
	return domain.AdminTask{
		ID:            sharedpg.UUIDFrom(r.ID),
		Slug:          r.Slug,
		TitleRU:       r.TitleRu,
		TitleEN:       r.TitleEn,
		DescriptionRU: r.DescriptionRu,
		DescriptionEN: r.DescriptionEn,
		Difficulty:    enums.Difficulty(r.Difficulty),
		Section:       enums.Section(r.Section),
		TimeLimitSec:  int(r.TimeLimitSec),
		MemoryLimitMB: int(r.MemoryLimitMb),
		SolutionHint:  r.SolutionHint.String,
		Version:       int(r.Version),
		IsActive:      r.IsActive,
		CreatedAt:     r.CreatedAt.Time,
		UpdatedAt:     r.UpdatedAt.Time,
	}
}
