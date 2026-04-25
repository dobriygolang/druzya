package app

import (
	"context"
	"fmt"
	"strings"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// TaskWithQuestions bundles a task and its task_questions for the admin
// detail view.
type TaskWithQuestions struct {
	Task      domain.MockTask
	Questions []domain.TaskQuestion
}

func (h *Handlers) ListTasks(ctx context.Context, f domain.TaskFilter) ([]domain.MockTask, error) {
	out, err := h.Tasks.List(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("tasks.List: %w", err)
	}
	return out, nil
}

func (h *Handlers) GetTaskWithQuestions(ctx context.Context, id uuid.UUID) (TaskWithQuestions, error) {
	t, err := h.Tasks.Get(ctx, id)
	if err != nil {
		return TaskWithQuestions{}, fmt.Errorf("tasks.Get: %w", err)
	}
	qs, err := h.Questions.ListTaskQuestions(ctx, id)
	if err != nil {
		return TaskWithQuestions{}, fmt.Errorf("questions.ListTaskQuestions: %w", err)
	}
	return TaskWithQuestions{Task: t, Questions: qs}, nil
}

// validateReferenceCriteria — the JSONB structure on mock_tasks /
// task_questions is closed-shape: only the three known string-array fields.
// Empty arrays are fine; nil arrays are normalised to empty slices so the
// JSON marshaller emits `[]` instead of `null` (UI-friendly).
func validateReferenceCriteria(rc *domain.ReferenceCriteria) {
	if rc.MustMention == nil {
		rc.MustMention = []string{}
	}
	if rc.NiceToHave == nil {
		rc.NiceToHave = []string{}
	}
	if rc.CommonPitfalls == nil {
		rc.CommonPitfalls = []string{}
	}
}

func (h *Handlers) CreateTask(ctx context.Context, t domain.MockTask) (domain.MockTask, error) {
	t.Title = strings.TrimSpace(t.Title)
	t.BodyMD = strings.TrimSpace(t.BodyMD)
	if t.Title == "" || t.BodyMD == "" {
		return domain.MockTask{}, fmt.Errorf("title/body required: %w", domain.ErrValidation)
	}
	if !t.StageKind.Valid() {
		return domain.MockTask{}, fmt.Errorf("stage_kind invalid: %w", domain.ErrValidation)
	}
	if t.Language == "" {
		t.Language = domain.LangAny
	}
	if !t.Language.Valid() {
		return domain.MockTask{}, fmt.Errorf("language invalid: %w", domain.ErrValidation)
	}
	if t.Difficulty < 1 || t.Difficulty > 5 {
		t.Difficulty = 2
	}
	if t.TimeLimitMin <= 0 {
		t.TimeLimitMin = 30
	}
	validateReferenceCriteria(&t.ReferenceCriteria)
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	now := h.Now().UTC()
	t.CreatedAt = now
	t.UpdatedAt = now
	out, err := h.Tasks.Create(ctx, t)
	if err != nil {
		return domain.MockTask{}, fmt.Errorf("tasks.Create: %w", err)
	}
	return out, nil
}

func (h *Handlers) UpdateTask(ctx context.Context, t domain.MockTask) (domain.MockTask, error) {
	if t.ID == uuid.Nil {
		return domain.MockTask{}, fmt.Errorf("id required: %w", domain.ErrValidation)
	}
	if !t.StageKind.Valid() || !t.Language.Valid() {
		return domain.MockTask{}, fmt.Errorf("enum invalid: %w", domain.ErrValidation)
	}
	validateReferenceCriteria(&t.ReferenceCriteria)
	t.UpdatedAt = h.Now().UTC()
	out, err := h.Tasks.Update(ctx, t)
	if err != nil {
		return domain.MockTask{}, fmt.Errorf("tasks.Update: %w", err)
	}
	return out, nil
}

func (h *Handlers) SetTaskActive(ctx context.Context, id uuid.UUID, active bool) error {
	if err := h.Tasks.SetActive(ctx, id, active); err != nil {
		return fmt.Errorf("tasks.SetActive: %w", err)
	}
	return nil
}
