// admin_tasks.go — admin CRUD use-cases over the canonical `tasks` table.
// Each Run pulls validated input, calls the repo, returns either the AdminTask
// projection or a domain sentinel error (ErrNotFound / ErrAdminTaskInvalid).
// HTTP/transport mapping is the caller's responsibility.
package app

import (
	"context"
	"fmt"

	"druz9/arena/domain"

	"github.com/google/uuid"
)

// section / difficulty allowlists kept in app-layer because they're pure
// validation on a wire-format value that has no domain entity yet.
func validateAdminSection(s string) bool {
	switch s {
	case "algorithms", "sql", "go", "system_design", "behavioral":
		return true
	}
	return false
}

func validateAdminDifficulty(d string) bool {
	return d == "easy" || d == "medium" || d == "hard"
}

// validateUpsert returns ErrAdminTaskInvalid (wrapped with detail) if the
// payload is malformed.
func validateUpsert(in domain.AdminTaskUpsert) error {
	if in.Slug == "" {
		return fmt.Errorf("%w: slug is required", domain.ErrAdminTaskInvalid)
	}
	if in.TitleRU == "" || in.TitleEN == "" {
		return fmt.Errorf("%w: title_ru and title_en are required", domain.ErrAdminTaskInvalid)
	}
	if !validateAdminDifficulty(in.Difficulty) {
		return fmt.Errorf("%w: difficulty must be easy|medium|hard", domain.ErrAdminTaskInvalid)
	}
	if !validateAdminSection(in.Section) {
		return fmt.Errorf("%w: section invalid", domain.ErrAdminTaskInvalid)
	}
	return nil
}

// ListAdminTasks lists arena tasks for the admin CMS.
type ListAdminTasks struct {
	Repo domain.AdminTaskRepo
}

// Run validates section/difficulty filters and returns the page.
func (uc *ListAdminTasks) Run(ctx context.Context, f domain.AdminTaskListFilter) ([]domain.AdminTask, error) {
	if f.Section != "" && !validateAdminSection(f.Section) {
		return nil, fmt.Errorf("%w: invalid section", domain.ErrAdminTaskInvalid)
	}
	if f.Difficulty != "" && !validateAdminDifficulty(f.Difficulty) {
		return nil, fmt.Errorf("%w: invalid difficulty", domain.ErrAdminTaskInvalid)
	}
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 200
	}
	out, err := uc.Repo.List(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("arena.ListAdminTasks: %w", err)
	}
	return out, nil
}

// GetAdminTask loads a single arena task by id.
type GetAdminTask struct {
	Repo domain.AdminTaskRepo
}

// Run returns ErrNotFound for unknown ids (wrapped — use errors.Is).
func (uc *GetAdminTask) Run(ctx context.Context, id uuid.UUID) (domain.AdminTask, error) {
	t, err := uc.Repo.Get(ctx, id)
	if err != nil {
		return domain.AdminTask{}, fmt.Errorf("arena.GetAdminTask: %w", err)
	}
	return t, nil
}

// CreateAdminTask inserts a new arena task. Defaults applied here keep the
// repo dumb (TimeLimitSec=60 / MemoryLimitMB=256 fallback when zero).
type CreateAdminTask struct {
	Repo domain.AdminTaskRepo
}

// Run validates, applies defaults, persists.
func (uc *CreateAdminTask) Run(ctx context.Context, in domain.AdminTaskUpsert) (domain.AdminTask, error) {
	if err := validateUpsert(in); err != nil {
		return domain.AdminTask{}, err
	}
	if in.TimeLimitSec <= 0 {
		in.TimeLimitSec = 60
	}
	if in.MemoryLimitMB <= 0 {
		in.MemoryLimitMB = 256
	}
	t, err := uc.Repo.Create(ctx, in)
	if err != nil {
		return domain.AdminTask{}, fmt.Errorf("arena.CreateAdminTask: %w", err)
	}
	return t, nil
}

// UpdateAdminTask rewrites an existing task identified by id.
type UpdateAdminTask struct {
	Repo domain.AdminTaskRepo
}

// Run validates payload then writes; ErrNotFound when row is missing.
func (uc *UpdateAdminTask) Run(ctx context.Context, id uuid.UUID, in domain.AdminTaskUpsert) (domain.AdminTask, error) {
	if err := validateUpsert(in); err != nil {
		return domain.AdminTask{}, err
	}
	t, err := uc.Repo.Update(ctx, id, in)
	if err != nil {
		return domain.AdminTask{}, fmt.Errorf("arena.UpdateAdminTask: %w", err)
	}
	return t, nil
}

// ToggleAdminTaskActive flips is_active without rewriting the rest of the row.
type ToggleAdminTaskActive struct {
	Repo domain.AdminTaskRepo
}

// Run returns ErrNotFound when no row matched.
func (uc *ToggleAdminTaskActive) Run(ctx context.Context, id uuid.UUID, active bool) error {
	if err := uc.Repo.SetActive(ctx, id, active); err != nil {
		return fmt.Errorf("arena.ToggleAdminTaskActive: %w", err)
	}
	return nil
}

// DeleteAdminTask removes a task. FK violations from match_history are
// surfaced raw — handler maps them to 409.
type DeleteAdminTask struct {
	Repo domain.AdminTaskRepo
}

// Run returns ErrNotFound when no row matched.
func (uc *DeleteAdminTask) Run(ctx context.Context, id uuid.UUID) error {
	if err := uc.Repo.Delete(ctx, id); err != nil {
		return fmt.Errorf("arena.DeleteAdminTask: %w", err)
	}
	return nil
}
