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

type Questions struct{ pool *pgxpool.Pool }

func NewQuestions(pool *pgxpool.Pool) *Questions { return &Questions{pool: pool} }

// ── task_questions ──────────────────────────────────────────────────────

const taskQCols = `id, task_id, body, expected_answer_md, reference_criteria, sort_order, created_at`

func (r *Questions) scanTaskQ(row pgx.Row) (domain.TaskQuestion, error) {
	var (
		id, taskID    pgtype.UUID
		body, expects string
		rc            []byte
		sortOrder     int
		createdAt     time.Time
	)
	if err := row.Scan(&id, &taskID, &body, &expects, &rc, &sortOrder, &createdAt); err != nil {
		return domain.TaskQuestion{}, fmt.Errorf("row.Scan task_questions: %w", err)
	}
	rcv, err := scanReferenceCriteria(rc)
	if err != nil {
		return domain.TaskQuestion{}, err
	}
	return domain.TaskQuestion{
		ID:                sharedpg.UUIDFrom(id),
		TaskID:            sharedpg.UUIDFrom(taskID),
		Body:              body,
		ExpectedAnswerMD:  expects,
		ReferenceCriteria: rcv,
		SortOrder:         sortOrder,
		CreatedAt:         createdAt,
	}, nil
}

func (r *Questions) ListTaskQuestions(ctx context.Context, taskID uuid.UUID) ([]domain.TaskQuestion, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+taskQCols+` FROM task_questions WHERE task_id=$1 ORDER BY sort_order ASC, created_at ASC`,
		sharedpg.UUID(taskID))
	if err != nil {
		return nil, fmt.Errorf("mock_interview.Questions.ListTaskQuestions: %w", err)
	}
	defer rows.Close()
	var out []domain.TaskQuestion
	for rows.Next() {
		q, err := r.scanTaskQ(rows)
		if err != nil {
			return nil, fmt.Errorf("mock_interview.Questions.ListTaskQuestions scan: %w", err)
		}
		out = append(out, q)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err task_questions.list: %w", err)
	}
	return out, nil
}

func (r *Questions) CreateTaskQuestion(ctx context.Context, q domain.TaskQuestion) (domain.TaskQuestion, error) {
	rcBytes, err := marshalReferenceCriteria(q.ReferenceCriteria)
	if err != nil {
		return domain.TaskQuestion{}, err
	}
	row := r.pool.QueryRow(ctx, `
		INSERT INTO task_questions (id, task_id, body, expected_answer_md, reference_criteria, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING `+taskQCols,
		sharedpg.UUID(q.ID), sharedpg.UUID(q.TaskID), q.Body, q.ExpectedAnswerMD,
		rcBytes, q.SortOrder)
	out, err := r.scanTaskQ(row)
	if err != nil {
		return domain.TaskQuestion{}, fmt.Errorf("mock_interview.Questions.CreateTaskQuestion: %w", err)
	}
	return out, nil
}

func (r *Questions) UpdateTaskQuestion(ctx context.Context, q domain.TaskQuestion) (domain.TaskQuestion, error) {
	rcBytes, err := marshalReferenceCriteria(q.ReferenceCriteria)
	if err != nil {
		return domain.TaskQuestion{}, err
	}
	row := r.pool.QueryRow(ctx, `
		UPDATE task_questions SET body=$2, expected_answer_md=$3, reference_criteria=$4, sort_order=$5
		WHERE id=$1 RETURNING `+taskQCols,
		sharedpg.UUID(q.ID), q.Body, q.ExpectedAnswerMD, rcBytes, q.SortOrder)
	out, err := r.scanTaskQ(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TaskQuestion{}, domain.ErrNotFound
		}
		return domain.TaskQuestion{}, fmt.Errorf("mock_interview.Questions.UpdateTaskQuestion: %w", err)
	}
	return out, nil
}

func (r *Questions) DeleteTaskQuestion(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM task_questions WHERE id=$1`, sharedpg.UUID(id))
	if err != nil {
		return fmt.Errorf("mock_interview.Questions.DeleteTaskQuestion: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ── stage_default_questions ─────────────────────────────────────────────

const defaultQCols = `id, stage_kind, body, expected_answer_md, reference_criteria, active, sort_order, created_at`

func (r *Questions) scanDefaultQ(row pgx.Row) (domain.DefaultQuestion, error) {
	var (
		id            pgtype.UUID
		stageKind     string
		body, expects string
		rc            []byte
		active        bool
		sortOrder     int
		createdAt     time.Time
	)
	if err := row.Scan(&id, &stageKind, &body, &expects, &rc, &active, &sortOrder, &createdAt); err != nil {
		return domain.DefaultQuestion{}, fmt.Errorf("row.Scan default_questions: %w", err)
	}
	rcv, err := scanReferenceCriteria(rc)
	if err != nil {
		return domain.DefaultQuestion{}, err
	}
	return domain.DefaultQuestion{
		ID:                sharedpg.UUIDFrom(id),
		StageKind:         domain.StageKind(stageKind),
		Body:              body,
		ExpectedAnswerMD:  expects,
		ReferenceCriteria: rcv,
		Active:            active,
		SortOrder:         sortOrder,
		CreatedAt:         createdAt,
	}, nil
}

func (r *Questions) ListDefaultQuestions(ctx context.Context, stage domain.StageKind, onlyActive bool) ([]domain.DefaultQuestion, error) {
	q := `SELECT ` + defaultQCols + ` FROM stage_default_questions WHERE 1=1`
	args := []any{}
	idx := 1
	if stage != "" {
		q += fmt.Sprintf(` AND stage_kind=$%d`, idx)
		args = append(args, string(stage))
	}
	if onlyActive {
		q += ` AND active = true`
	}
	q += ` ORDER BY sort_order ASC, created_at ASC`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("mock_interview.Questions.ListDefaultQuestions: %w", err)
	}
	defer rows.Close()
	var out []domain.DefaultQuestion
	for rows.Next() {
		dq, err := r.scanDefaultQ(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, dq)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err default_questions.list: %w", err)
	}
	return out, nil
}

// SampleDefaultQuestions returns up to `limit` randomly-ordered active
// rows. limit<=0 short-circuits to ListDefaultQuestions(stage, true).
func (r *Questions) SampleDefaultQuestions(ctx context.Context, stage domain.StageKind, limit int) ([]domain.DefaultQuestion, error) {
	if limit <= 0 {
		return r.ListDefaultQuestions(ctx, stage, true)
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+defaultQCols+`
		  FROM stage_default_questions
		 WHERE stage_kind=$1 AND active = true
		 ORDER BY random()
		 LIMIT $2`, string(stage), limit)
	if err != nil {
		return nil, fmt.Errorf("mock_interview.Questions.SampleDefaultQuestions: %w", err)
	}
	defer rows.Close()
	var out []domain.DefaultQuestion
	for rows.Next() {
		dq, err := r.scanDefaultQ(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, dq)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err default_questions.sample: %w", err)
	}
	return out, nil
}

func (r *Questions) CreateDefaultQuestion(ctx context.Context, q domain.DefaultQuestion) (domain.DefaultQuestion, error) {
	rcBytes, err := marshalReferenceCriteria(q.ReferenceCriteria)
	if err != nil {
		return domain.DefaultQuestion{}, err
	}
	row := r.pool.QueryRow(ctx, `
		INSERT INTO stage_default_questions (id, stage_kind, body, expected_answer_md, reference_criteria, active, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING `+defaultQCols,
		sharedpg.UUID(q.ID), string(q.StageKind), q.Body, q.ExpectedAnswerMD,
		rcBytes, q.Active, q.SortOrder)
	out, err := r.scanDefaultQ(row)
	if err != nil {
		return domain.DefaultQuestion{}, fmt.Errorf("mock_interview.Questions.CreateDefaultQuestion: %w", err)
	}
	return out, nil
}

func (r *Questions) UpdateDefaultQuestion(ctx context.Context, q domain.DefaultQuestion) (domain.DefaultQuestion, error) {
	rcBytes, err := marshalReferenceCriteria(q.ReferenceCriteria)
	if err != nil {
		return domain.DefaultQuestion{}, err
	}
	row := r.pool.QueryRow(ctx, `
		UPDATE stage_default_questions SET stage_kind=$2, body=$3, expected_answer_md=$4,
			reference_criteria=$5, active=$6, sort_order=$7
		WHERE id=$1 RETURNING `+defaultQCols,
		sharedpg.UUID(q.ID), string(q.StageKind), q.Body, q.ExpectedAnswerMD,
		rcBytes, q.Active, q.SortOrder)
	out, err := r.scanDefaultQ(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.DefaultQuestion{}, domain.ErrNotFound
		}
		return domain.DefaultQuestion{}, fmt.Errorf("mock_interview.Questions.UpdateDefaultQuestion: %w", err)
	}
	return out, nil
}

func (r *Questions) DeleteDefaultQuestion(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM stage_default_questions WHERE id=$1`, sharedpg.UUID(id))
	if err != nil {
		return fmt.Errorf("mock_interview.Questions.DeleteDefaultQuestion: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ── company_questions ───────────────────────────────────────────────────

const companyQCols = `id, company_id, stage_kind, body, expected_answer_md, reference_criteria, active, sort_order, created_at`

func (r *Questions) scanCompanyQ(row pgx.Row) (domain.CompanyQuestion, error) {
	var (
		id, companyID pgtype.UUID
		stageKind     string
		body, expects string
		rc            []byte
		active        bool
		sortOrder     int
		createdAt     time.Time
	)
	if err := row.Scan(&id, &companyID, &stageKind, &body, &expects, &rc, &active, &sortOrder, &createdAt); err != nil {
		return domain.CompanyQuestion{}, fmt.Errorf("row.Scan company_questions: %w", err)
	}
	rcv, err := scanReferenceCriteria(rc)
	if err != nil {
		return domain.CompanyQuestion{}, err
	}
	return domain.CompanyQuestion{
		ID:                sharedpg.UUIDFrom(id),
		CompanyID:         sharedpg.UUIDFrom(companyID),
		StageKind:         domain.StageKind(stageKind),
		Body:              body,
		ExpectedAnswerMD:  expects,
		ReferenceCriteria: rcv,
		Active:            active,
		SortOrder:         sortOrder,
		CreatedAt:         createdAt,
	}, nil
}

func (r *Questions) ListCompanyQuestions(ctx context.Context, companyID uuid.UUID, stage domain.StageKind) ([]domain.CompanyQuestion, error) {
	q := `SELECT ` + companyQCols + ` FROM company_questions WHERE company_id=$1`
	args := []any{sharedpg.UUID(companyID)}
	if stage != "" {
		q += ` AND stage_kind=$2`
		args = append(args, string(stage))
	}
	q += ` ORDER BY sort_order ASC, created_at ASC`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("mock_interview.Questions.ListCompanyQuestions: %w", err)
	}
	defer rows.Close()
	var out []domain.CompanyQuestion
	for rows.Next() {
		cq, err := r.scanCompanyQ(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, cq)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err company_questions.list: %w", err)
	}
	return out, nil
}

// SampleCompanyQuestions: per-company variant of SampleDefaultQuestions.
func (r *Questions) SampleCompanyQuestions(ctx context.Context, companyID uuid.UUID, stage domain.StageKind, limit int) ([]domain.CompanyQuestion, error) {
	if limit <= 0 {
		return r.ListCompanyQuestions(ctx, companyID, stage)
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+companyQCols+`
		  FROM company_questions
		 WHERE company_id=$1 AND stage_kind=$2 AND active = true
		 ORDER BY random()
		 LIMIT $3`, sharedpg.UUID(companyID), string(stage), limit)
	if err != nil {
		return nil, fmt.Errorf("mock_interview.Questions.SampleCompanyQuestions: %w", err)
	}
	defer rows.Close()
	var out []domain.CompanyQuestion
	for rows.Next() {
		cq, err := r.scanCompanyQ(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, cq)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err company_questions.sample: %w", err)
	}
	return out, nil
}

func (r *Questions) CreateCompanyQuestion(ctx context.Context, q domain.CompanyQuestion) (domain.CompanyQuestion, error) {
	rcBytes, err := marshalReferenceCriteria(q.ReferenceCriteria)
	if err != nil {
		return domain.CompanyQuestion{}, err
	}
	row := r.pool.QueryRow(ctx, `
		INSERT INTO company_questions (id, company_id, stage_kind, body, expected_answer_md, reference_criteria, active, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING `+companyQCols,
		sharedpg.UUID(q.ID), sharedpg.UUID(q.CompanyID), string(q.StageKind),
		q.Body, q.ExpectedAnswerMD, rcBytes, q.Active, q.SortOrder)
	out, err := r.scanCompanyQ(row)
	if err != nil {
		return domain.CompanyQuestion{}, fmt.Errorf("mock_interview.Questions.CreateCompanyQuestion: %w", err)
	}
	return out, nil
}

func (r *Questions) UpdateCompanyQuestion(ctx context.Context, q domain.CompanyQuestion) (domain.CompanyQuestion, error) {
	rcBytes, err := marshalReferenceCriteria(q.ReferenceCriteria)
	if err != nil {
		return domain.CompanyQuestion{}, err
	}
	row := r.pool.QueryRow(ctx, `
		UPDATE company_questions SET stage_kind=$2, body=$3, expected_answer_md=$4,
			reference_criteria=$5, active=$6, sort_order=$7
		WHERE id=$1 RETURNING `+companyQCols,
		sharedpg.UUID(q.ID), string(q.StageKind), q.Body, q.ExpectedAnswerMD,
		rcBytes, q.Active, q.SortOrder)
	out, err := r.scanCompanyQ(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.CompanyQuestion{}, domain.ErrNotFound
		}
		return domain.CompanyQuestion{}, fmt.Errorf("mock_interview.Questions.UpdateCompanyQuestion: %w", err)
	}
	return out, nil
}

func (r *Questions) DeleteCompanyQuestion(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM company_questions WHERE id=$1`, sharedpg.UUID(id))
	if err != nil {
		return fmt.Errorf("mock_interview.Questions.DeleteCompanyQuestion: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

var _ domain.QuestionRepo = (*Questions)(nil)
