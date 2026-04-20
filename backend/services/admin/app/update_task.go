package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

// UpdateTask implements PUT /api/v1/admin/tasks/{taskId}.
type UpdateTask struct {
	Tasks domain.TaskRepo
}

// Do validates, then refreshes the task aggregate (task + children are
// replaced en bloc). The adapter bumps tasks.version on every mutation.
//
// STUB: task CSV import — curators have asked for a bulk-import flow to seed
// entire sections at once; not wired for MVP. The proposed CSV shape is
// documented in bible §3.14 but the parser + dry-run UI live in a later PR.
func (uc *UpdateTask) Do(ctx context.Context, id uuid.UUID, in domain.TaskUpsert) (domain.AdminTask, error) {
	if err := domain.ValidateTaskUpsert(in); err != nil {
		return domain.AdminTask{}, fmt.Errorf("admin.UpdateTask: %w", err)
	}
	out, err := uc.Tasks.Update(ctx, id, in)
	if err != nil {
		return domain.AdminTask{}, fmt.Errorf("admin.UpdateTask: %w", err)
	}
	return out, nil
}
