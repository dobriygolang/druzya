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

var _ domain.MockTaskTestCaseRepo = (*MockTaskTestCases)(nil)
