// tasks.go — Notion-style TaskBoard use cases.
//
// Hone is the *coach panel*, not the validator. The real work happens in
// the main project (arena, mock_interview, codex, daily) — these use
// cases own only the kanban surface: create cards, move them between
// columns, attach comments, enforce the cap=7 in_todo guard.
//
// Status transitions and AI-driven moves are handled by coach_listener.go
// which subscribes to the bus.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// MaxInTodoPerUser — at most N tasks may sit in the `todo` column at the
// same time. Past this the AI generator skips suggestions; the user can
// still add custom tasks (we only block AI-source). dynamic_config knob
// `hone_taskboard_todo_cap` overrides at runtime.
const MaxInTodoPerUser = 7

// CreateTask — manual user task. Always source='user'; AI tasks are
// produced via the coach generator (see coach_generator.go).
//
// Phase 10 — optional Categoriser hook. Когда LLM available, UC после
// Create зовёт CategoriseTask UC чтобы AI инфер'ил column placement
// (todo/doing/done) + tags по deadline/kind. Fail-soft: ошибка LLM не
// блокирует Create — task остаётся в default todo column.
type CreateTask struct {
	Tasks       domain.TaskRepo
	Log         *slog.Logger
	Categoriser *CategoriseTask // optional · nil → skip auto-place
}

// CreateTaskInput.
type CreateTaskInput struct {
	UserID   uuid.UUID
	Kind     domain.TaskKind
	Title    string
	BriefMD  string
	SkillKey string
	DeepLink string
}

// Do executes the use case.
func (uc *CreateTask) Do(ctx context.Context, in CreateTaskInput) (domain.Task, error) {
	if in.Title == "" {
		return domain.Task{}, fmt.Errorf("hone.CreateTask: %w: empty title", domain.ErrInvalidInput)
	}
	kind := in.Kind
	if !kind.IsValid() {
		kind = domain.TaskKindCustom
	}
	t := domain.Task{
		UserID:   in.UserID,
		Status:   domain.TaskStatusToDo,
		Kind:     kind,
		Source:   domain.TaskSourceUser,
		Title:    in.Title,
		BriefMD:  in.BriefMD,
		SkillKey: in.SkillKey,
		DeepLink: in.DeepLink,
	}
	created, err := uc.Tasks.Create(ctx, t)
	if err != nil {
		return domain.Task{}, fmt.Errorf("hone.CreateTask: %w", err)
	}

	// Phase 10 auto-place. Skip когда Categoriser nil (LLM не wired).
	// Failure не блокирует Create — task уже сохранён, просто остаётся
	// в default todo column. UI может observe new column через next
	// ListTasks fetch.
	if uc.Categoriser != nil {
		go func() {
			catCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			out, err := uc.Categoriser.Do(catCtx, CategoriseTaskInput{
				Title:    in.Title,
				BriefMD:  in.BriefMD,
				Kind:     string(kind),
				SkillKey: in.SkillKey,
			})
			if err != nil {
				if uc.Log != nil {
					uc.Log.Warn("hone.CreateTask: categorise failed", "err", err, "task_id", created.ID)
				}
				return
			}
			// Apply column placement если LLM выдал не-default.
			if newStatus := domain.TaskStatus(out.Column); newStatus.IsValid() && newStatus != domain.TaskStatusToDo {
				if _, err := uc.Tasks.SetStatus(catCtx, in.UserID, created.ID, newStatus); err != nil && uc.Log != nil {
					uc.Log.Warn("hone.CreateTask: categorise SetStatus", "err", err, "task_id", created.ID)
				}
			}
		}()
	}

	return created, nil
}

// ListTasks — board read for the frontend.
type ListTasks struct {
	Tasks domain.TaskRepo
}

// Do returns the user's tasks across todo/in_progress/in_review/done.
// `dismissed` is excluded from the default list view (still reachable via
// admin / future "history" filter).
func (uc *ListTasks) Do(ctx context.Context, userID uuid.UUID) ([]domain.Task, error) {
	rows, err := uc.Tasks.ListByUser(ctx, userID, nil, 200)
	if err != nil {
		return nil, fmt.Errorf("hone.ListTasks: %w", err)
	}
	return rows, nil
}

// MoveTaskStatus — explicit user move (drag-and-drop or button). The AI
// listener uses the same repo path but bypasses this use case so the
// caller-side guards stay user-only.
type MoveTaskStatus struct {
	Tasks domain.TaskRepo
	Log   *slog.Logger
}

// MoveTaskStatusInput.
type MoveTaskStatusInput struct {
	UserID uuid.UUID
	TaskID uuid.UUID
	Status domain.TaskStatus
}

// Do executes the use case.
func (uc *MoveTaskStatus) Do(ctx context.Context, in MoveTaskStatusInput) (domain.Task, error) {
	if !in.Status.IsValid() {
		return domain.Task{}, fmt.Errorf("hone.MoveTaskStatus: %w: invalid status %q", domain.ErrInvalidInput, in.Status)
	}
	updated, err := uc.Tasks.SetStatus(ctx, in.UserID, in.TaskID, in.Status)
	if err != nil {
		return domain.Task{}, fmt.Errorf("hone.MoveTaskStatus: %w", err)
	}
	return updated, nil
}

// DeleteTask removes a task (and cascades comments).
type DeleteTask struct {
	Tasks domain.TaskRepo
}

// Do executes the use case.
func (uc *DeleteTask) Do(ctx context.Context, userID, taskID uuid.UUID) error {
	if err := uc.Tasks.Delete(ctx, userID, taskID); err != nil {
		return fmt.Errorf("hone.DeleteTask: %w", err)
	}
	return nil
}

// AddTaskComment — user-authored thread message.
type AddTaskComment struct {
	Tasks domain.TaskRepo
}

// AddTaskCommentInput.
type AddTaskCommentInput struct {
	UserID uuid.UUID
	TaskID uuid.UUID
	BodyMD string
}

// Do executes the use case.
func (uc *AddTaskComment) Do(ctx context.Context, in AddTaskCommentInput) (domain.TaskComment, error) {
	// Verify ownership before writing — the comment FK alone won't catch
	// "comment on someone else's task" since hone_task_comments has no
	// user_id column (CASCADE-deletes with the task).
	if _, err := uc.Tasks.Get(ctx, in.UserID, in.TaskID); err != nil {
		return domain.TaskComment{}, fmt.Errorf("hone.AddTaskComment: %w", err)
	}
	if in.BodyMD == "" {
		return domain.TaskComment{}, fmt.Errorf("hone.AddTaskComment: %w: empty body", domain.ErrInvalidInput)
	}
	c, err := uc.Tasks.AddComment(ctx, domain.TaskComment{
		TaskID:     in.TaskID,
		AuthorKind: domain.TaskCommentAuthorUser,
		BodyMD:     in.BodyMD,
	})
	if err != nil {
		return domain.TaskComment{}, fmt.Errorf("hone.AddTaskComment: %w", err)
	}
	return c, nil
}

// ListTaskComments — read the thread.
type ListTaskComments struct {
	Tasks domain.TaskRepo
}

// Do executes the use case.
func (uc *ListTaskComments) Do(ctx context.Context, userID, taskID uuid.UUID) ([]domain.TaskComment, error) {
	if _, err := uc.Tasks.Get(ctx, userID, taskID); err != nil {
		return nil, fmt.Errorf("hone.ListTaskComments: %w", err)
	}
	rows, err := uc.Tasks.ListComments(ctx, taskID)
	if err != nil {
		return nil, fmt.Errorf("hone.ListTaskComments: %w", err)
	}
	return rows, nil
}

// ── AI-side helpers (used by coach listener / generator) ─────────────────

// SpawnAITask — internal helper used by the coach generator. Enforces the
// dedup gate (existing open task on the same skill_key short-circuits) and
// the cap=7 in_todo gate. Returns a flag on whether the task was actually
// created so the generator can log "wanted to suggest X but cap full".
type SpawnAITask struct {
	Tasks   domain.TaskRepo
	Log     *slog.Logger
	TodoCap int // 0 → MaxInTodoPerUser
}

// SpawnAITaskInput.
type SpawnAITaskInput struct {
	UserID             uuid.UUID
	Kind               domain.TaskKind
	Title              string
	BriefMD            string
	SkillKey           string
	DeepLink           string
	RecommendedReading []string
	Priority           int16
}

// SpawnAITaskResult.
type SpawnAITaskResult struct {
	Created bool
	Task    domain.Task
	Reason  string // "deduped" | "cap_full" | "ok"
}

// Do executes the use case.
func (uc *SpawnAITask) Do(ctx context.Context, in SpawnAITaskInput) (SpawnAITaskResult, error) {
	cap := uc.TodoCap
	if cap <= 0 {
		cap = MaxInTodoPerUser
	}
	if in.SkillKey != "" {
		existing, err := uc.Tasks.FindOpenBySkill(ctx, in.UserID, in.SkillKey)
		if err == nil {
			return SpawnAITaskResult{Created: false, Task: existing, Reason: "deduped"}, nil
		}
		if !errors.Is(err, domain.ErrNotFound) {
			return SpawnAITaskResult{}, fmt.Errorf("hone.SpawnAITask: dedup probe: %w", err)
		}
	}
	count, err := uc.Tasks.CountInTodo(ctx, in.UserID)
	if err != nil {
		return SpawnAITaskResult{}, fmt.Errorf("hone.SpawnAITask: count: %w", err)
	}
	if count >= cap {
		return SpawnAITaskResult{Created: false, Reason: "cap_full"}, nil
	}
	t := domain.Task{
		UserID:             in.UserID,
		Status:             domain.TaskStatusToDo,
		Kind:               in.Kind,
		Source:             domain.TaskSourceAI,
		Title:              in.Title,
		BriefMD:            in.BriefMD,
		SkillKey:           in.SkillKey,
		DeepLink:           in.DeepLink,
		RecommendedReading: in.RecommendedReading,
		Priority:           in.Priority,
	}
	created, err := uc.Tasks.Create(ctx, t)
	if err != nil {
		return SpawnAITaskResult{}, fmt.Errorf("hone.SpawnAITask: create: %w", err)
	}
	return SpawnAITaskResult{Created: true, Task: created, Reason: "ok"}, nil
}

// ── TTL sweep ────────────────────────────────────────────────────────────

// AutoDismissExpired runs in a cron and flips abandoned `todo` cards to
// `dismissed` after the TTL window. Called from app.TaskCleanupWorker.
type AutoDismissExpired struct {
	Tasks  domain.TaskRepo
	Window time.Duration
	Now    func() time.Time
	Log    *slog.Logger
}

// Do executes the use case.
func (uc *AutoDismissExpired) Do(ctx context.Context) (int64, error) {
	now := time.Now
	if uc.Now != nil {
		now = uc.Now
	}
	window := uc.Window
	if window <= 0 {
		window = 14 * 24 * time.Hour
	}
	cutoff := now().UTC().Add(-window)
	n, err := uc.Tasks.AutoDismissOlderThan(ctx, cutoff)
	if err != nil {
		return 0, fmt.Errorf("hone.AutoDismissExpired: %w", err)
	}
	if n > 0 && uc.Log != nil {
		uc.Log.InfoContext(ctx, "hone.tasks: auto-dismissed expired",
			slog.Int64("count", n), slog.Time("cutoff", cutoff))
	}
	return n, nil
}
