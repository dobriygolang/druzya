// goal_presets.go — Admin Phase 2: goal preset CRUD use cases.
//
// Four small UCs (List / Create / Update / Deactivate) на тонкой обёртке
// над repo. Read path is symmetric: admin видит all, public видит active
// only — единственный различающий аргумент в ListGoalPresets.
//
// Validation rules (минимальные, чтобы не блокировать curator'а):
//   - Create: slug + title + kind non-empty, kind starts with "GOAL_KIND_".
//   - Update: minor — те же поля если переданы.
//   - DefaultTargetDays: 0..3650 (10 лет), отрицательное = clear (NULL).
package app

import (
	"context"
	"fmt"
	"strings"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

const (
	goalKindPrefix       = "GOAL_KIND_"
	maxDefaultTargetDays = 3650
)

// ─────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────

// ListGoalPresets — read-only UC.
type ListGoalPresets struct {
	Repo domain.GoalPresetRepo
}

// Do — when activeOnly=true, filters is_active=true (used by public REST
// для GoalWizard). Admin CMS passes false to see deactivated presets too.
func (uc *ListGoalPresets) Do(ctx context.Context, activeOnly bool) ([]domain.GoalPreset, error) {
	out, err := uc.Repo.List(ctx, activeOnly)
	if err != nil {
		return nil, fmt.Errorf("admin.ListGoalPresets: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────

// CreateGoalPreset — admin-only.
type CreateGoalPreset struct {
	Repo domain.GoalPresetRepo
}

// Do validates + persists. Returns ErrInvalidInput on validation fails,
// ErrConflict on duplicate slug (repo maps unique-violation).
func (uc *CreateGoalPreset) Do(ctx context.Context, in domain.GoalPresetUpsert) (domain.GoalPreset, error) {
	if err := validateUpsert(in); err != nil {
		return domain.GoalPreset{}, err
	}
	out, err := uc.Repo.Create(ctx, in)
	if err != nil {
		return domain.GoalPreset{}, fmt.Errorf("admin.CreateGoalPreset: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────

// UpdateGoalPreset — partial-patch UC. Empty patch = no-op (returns
// current row).
type UpdateGoalPreset struct {
	Repo domain.GoalPresetRepo
}

// Do validates patched fields + delegates to repo.
func (uc *UpdateGoalPreset) Do(ctx context.Context, id uuid.UUID, patch domain.GoalPresetPatch) (domain.GoalPreset, error) {
	if id == uuid.Nil {
		return domain.GoalPreset{}, fmt.Errorf("%w: id required", domain.ErrInvalidInput)
	}
	if err := validatePatch(patch); err != nil {
		return domain.GoalPreset{}, err
	}
	out, err := uc.Repo.Update(ctx, id, patch)
	if err != nil {
		return domain.GoalPreset{}, fmt.Errorf("admin.UpdateGoalPreset: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Deactivate
// ─────────────────────────────────────────────────────────────────────────

// DeactivateGoalPreset — soft delete (sets is_active=false).
type DeactivateGoalPreset struct {
	Repo domain.GoalPresetRepo
}

// Do flips is_active to false. Idempotent: calling on already-deactivated
// preset returns ErrNotFound only if the row doesn't exist at all.
func (uc *DeactivateGoalPreset) Do(ctx context.Context, id uuid.UUID) error {
	if id == uuid.Nil {
		return fmt.Errorf("%w: id required", domain.ErrInvalidInput)
	}
	if err := uc.Repo.Deactivate(ctx, id); err != nil {
		return fmt.Errorf("admin.DeactivateGoalPreset: %w", err)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────

func validateUpsert(in domain.GoalPresetUpsert) error {
	if strings.TrimSpace(in.Slug) == "" {
		return fmt.Errorf("%w: slug required", domain.ErrInvalidInput)
	}
	if strings.TrimSpace(in.Title) == "" {
		return fmt.Errorf("%w: title required", domain.ErrInvalidInput)
	}
	if !strings.HasPrefix(in.Kind, goalKindPrefix) {
		return fmt.Errorf("%w: kind must start with %s", domain.ErrInvalidInput, goalKindPrefix)
	}
	if in.DefaultTargetDays != nil {
		d := *in.DefaultTargetDays
		if d < 0 || d > maxDefaultTargetDays {
			return fmt.Errorf("%w: default_target_days out of range", domain.ErrInvalidInput)
		}
	}
	return nil
}

func validatePatch(p domain.GoalPresetPatch) error {
	if p.Title != nil && strings.TrimSpace(*p.Title) == "" {
		return fmt.Errorf("%w: title cannot be blank", domain.ErrInvalidInput)
	}
	if p.Kind != nil && !strings.HasPrefix(*p.Kind, goalKindPrefix) {
		return fmt.Errorf("%w: kind must start with %s", domain.ErrInvalidInput, goalKindPrefix)
	}
	if p.DefaultTargetDays != nil {
		d := *p.DefaultTargetDays
		// d == -1 sentinel — caller wants to clear NULL; allowed.
		if d < -1 || d > maxDefaultTargetDays {
			return fmt.Errorf("%w: default_target_days out of range", domain.ErrInvalidInput)
		}
	}
	return nil
}
