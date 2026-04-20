package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// CreateTask implements POST /api/v1/admin/tasks.
type CreateTask struct {
	Tasks domain.TaskRepo
}

// Do validates then persists a new task aggregate (task + children) in a
// single transaction inside the adapter.
func (uc *CreateTask) Do(ctx context.Context, in domain.TaskUpsert) (domain.AdminTask, error) {
	if err := domain.ValidateTaskUpsert(in); err != nil {
		return domain.AdminTask{}, fmt.Errorf("admin.CreateTask: %w", err)
	}
	out, err := uc.Tasks.Create(ctx, in)
	if err != nil {
		return domain.AdminTask{}, fmt.Errorf("admin.CreateTask: %w", err)
	}
	return out, nil
}
