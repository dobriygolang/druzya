package infra

import (
	"context"
	"fmt"

	"druz9/mock_interview/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MockTaskTestCases — pgx adapter for the `mock_task_test_cases` table
// (see migration 00046).
type MockTaskTestCases struct{ pool *pgxpool.Pool }

// NewMockTaskTestCases wires the repo.
func NewMockTaskTestCases(pool *pgxpool.Pool) *MockTaskTestCases {
	return &MockTaskTestCases{pool: pool}
}

// ListForTask returns every test case for a task, ordered by ordinal asc.
// Empty slice (not error) when no rows exist — orchestrator uses that to
// fall back to LLM-only judging.
func (r *MockTaskTestCases) ListForTask(ctx context.Context, taskID uuid.UUID) ([]domain.MockTaskTestCase, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, task_id, input, expected_output, is_hidden, ordinal
		FROM mock_task_test_cases
		WHERE task_id = $1
		ORDER BY ordinal ASC, id ASC`, sharedpg.UUID(taskID))
	if err != nil {
		return nil, fmt.Errorf("mock_interview.MockTaskTestCases.ListForTask: %w", err)
	}
	defer rows.Close()
	var out []domain.MockTaskTestCase
	for rows.Next() {
		var (
			id, tid    pgtype.UUID
			input, exp string
			hidden     bool
			ordinal    int32
		)
		if err := rows.Scan(&id, &tid, &input, &exp, &hidden, &ordinal); err != nil {
			return nil, fmt.Errorf("rows.Scan mock_task_test_cases: %w", err)
		}
		out = append(out, domain.MockTaskTestCase{
			ID:       sharedpg.UUIDFrom(id),
			TaskID:   sharedpg.UUIDFrom(tid),
			Input:    input,
			Expected: exp,
			IsHidden: hidden,
			Ordinal:  int(ordinal),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err mock_task_test_cases: %w", err)
	}
	return out, nil
}

// Create inserts a single test case. ID is server-generated when zero.
func (r *MockTaskTestCases) Create(ctx context.Context, tc domain.MockTaskTestCase) (domain.MockTaskTestCase, error) {
	if tc.ID == uuid.Nil {
		tc.ID = uuid.New()
	}
	row := r.pool.QueryRow(ctx, `
		INSERT INTO mock_task_test_cases (id, task_id, input, expected_output, is_hidden, ordinal)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, task_id, input, expected_output, is_hidden, ordinal`,
		sharedpg.UUID(tc.ID), sharedpg.UUID(tc.TaskID),
		tc.Input, tc.Expected, tc.IsHidden, tc.Ordinal)
	out, err := scanTestCase(row)
	if err != nil {
		return domain.MockTaskTestCase{}, fmt.Errorf("mock_interview.MockTaskTestCases.Create: %w", err)
	}
	return out, nil
}

// Update overwrites everything except (id, task_id, created_at).
func (r *MockTaskTestCases) Update(ctx context.Context, tc domain.MockTaskTestCase) (domain.MockTaskTestCase, error) {
	row := r.pool.QueryRow(ctx, `
		UPDATE mock_task_test_cases
		   SET input=$2, expected_output=$3, is_hidden=$4, ordinal=$5
		 WHERE id=$1
		RETURNING id, task_id, input, expected_output, is_hidden, ordinal`,
		sharedpg.UUID(tc.ID), tc.Input, tc.Expected, tc.IsHidden, tc.Ordinal)
	out, err := scanTestCase(row)
	if err != nil {
		return domain.MockTaskTestCase{}, fmt.Errorf("mock_interview.MockTaskTestCases.Update: %w", err)
	}
	return out, nil
}

// Delete removes a single test case. ErrNotFound when no row matches.
func (r *MockTaskTestCases) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM mock_task_test_cases WHERE id=$1`, sharedpg.UUID(id))
	if err != nil {
		return fmt.Errorf("mock_interview.MockTaskTestCases.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// scanTestCase — shared scan helper, deliberately matches the columns
// returned by Create / Update so a callsite swap stays trivial.
func scanTestCase(row interface {
	Scan(...any) error
}) (domain.MockTaskTestCase, error) {
	var (
		id, tid    pgtype.UUID
		input, exp string
		hidden     bool
		ordinal    int32
	)
	if err := row.Scan(&id, &tid, &input, &exp, &hidden, &ordinal); err != nil {
		return domain.MockTaskTestCase{}, fmt.Errorf("row.Scan mock_task_test_cases: %w", err)
	}
	return domain.MockTaskTestCase{
		ID:       sharedpg.UUIDFrom(id),
		TaskID:   sharedpg.UUIDFrom(tid),
		Input:    input,
		Expected: exp,
		IsHidden: hidden,
		Ordinal:  int(ordinal),
	}, nil
}

var _ domain.MockTaskTestCaseRepo = (*MockTaskTestCases)(nil)
