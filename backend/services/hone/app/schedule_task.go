// schedule_task.go — time-blocking use cases.
//
// Юзер таскает карточки из бэклога в часовые слоты day-view → бэк пишет
// scheduled_start + scheduled_duration_min на hone_tasks row. UC лежит
// отдельным файлом (а не в tasks.go), потому что time-blocking — новая
// концепция со своими валидациями (длительность, лимит на день),
// которые в обычных kanban-операциях не нужны.
package app

import (
	"fmt"
	"time"

	"context"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ScheduleTask пинит карточку в календарь.
type ScheduleTask struct {
	Tasks domain.TaskRepo
	Cache TasksListCache // optional · invalidate ListTasks cache
}

// ScheduleTaskInput.
type ScheduleTaskInput struct {
	UserID         uuid.UUID
	TaskID         uuid.UUID
	ScheduledStart time.Time
	DurationMin    int
}

// Do executes the use case.
func (uc *ScheduleTask) Do(ctx context.Context, in ScheduleTaskInput) (domain.Task, error) {
	if in.ScheduledStart.IsZero() {
		return domain.Task{}, fmt.Errorf("hone.ScheduleTask: %w: scheduled_start required", domain.ErrInvalidInput)
	}
	if in.DurationMin < 15 || in.DurationMin > 480 {
		return domain.Task{}, fmt.Errorf("hone.ScheduleTask: %w: duration_min out of range (15..480), got %d",
			domain.ErrInvalidInput, in.DurationMin)
	}
	t, err := uc.Tasks.Schedule(ctx, in.UserID, in.TaskID, in.ScheduledStart, in.DurationMin)
	if err != nil {
		return domain.Task{}, fmt.Errorf("hone.ScheduleTask: %w", err)
	}
	InvalidateTasksCacheForUser(ctx, uc.Cache, in.UserID)
	return t, nil
}

// UnscheduleTask возвращает карточку в бэклог.
type UnscheduleTask struct {
	Tasks domain.TaskRepo
	Cache TasksListCache // optional · invalidate ListTasks cache
}

// Do executes the use case.
func (uc *UnscheduleTask) Do(ctx context.Context, userID, taskID uuid.UUID) (domain.Task, error) {
	t, err := uc.Tasks.Unschedule(ctx, userID, taskID)
	if err != nil {
		return domain.Task{}, fmt.Errorf("hone.UnscheduleTask: %w", err)
	}
	InvalidateTasksCacheForUser(ctx, uc.Cache, userID)
	return t, nil
}
