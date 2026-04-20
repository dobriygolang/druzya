// Package app contains the admin use cases. Each endpoint is its own file.
// Role enforcement lives at the ports layer; app/ assumes the caller is
// already an authenticated admin.
package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// ListTasks implements GET /api/v1/admin/tasks.
type ListTasks struct {
	Tasks domain.TaskRepo
}

// Do returns a filtered, paginated page of tasks.
func (uc *ListTasks) Do(ctx context.Context, f domain.TaskFilter) (domain.TaskPage, error) {
	page, err := uc.Tasks.List(ctx, f)
	if err != nil {
		return domain.TaskPage{}, fmt.Errorf("admin.ListTasks: %w", err)
	}
	return page, nil
}
