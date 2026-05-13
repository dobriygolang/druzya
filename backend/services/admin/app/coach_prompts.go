// coach_prompts.go — Admin Phase 2: coach prompt CRUD use cases.
//
// Four thin UCs (List / Create / Update / Deactivate) over CoachPromptRepo.
// Validation:
//   - slug + category + template non-empty.
//   - category в allowed set (whitelist).
//   - variables — each item shaped как «{{name}}».
//
// Version bump происходит repo-side при каждом Update (audit trail).
package app

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

// allowedCoachCategories — whitelist для category column. Sliver of
// validation чтобы curator не натворил тайпов; expand при появлении
// новых intelligence surface.
var allowedCoachCategories = map[string]struct{}{
	"daily_brief":      {},
	"insight":          {},
	"mock_grade":       {},
	"reflection_grade": {},
	"cue_summary":      {},
	"milestones_gen":   {},
	"ml_drill":         {},
}

// variableRE — простая проверка что variable выглядит как {{name}}.
var variableRE = regexp.MustCompile(`^\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}$`)

// ─────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────

// ListCoachPrompts — read-only UC.
type ListCoachPrompts struct {
	Repo domain.CoachPromptRepo
}

// Do — when activeOnly=true filters is_active=true.
func (uc *ListCoachPrompts) Do(ctx context.Context, activeOnly bool) ([]domain.CoachPrompt, error) {
	out, err := uc.Repo.List(ctx, activeOnly)
	if err != nil {
		return nil, fmt.Errorf("admin.ListCoachPrompts: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────

// CreateCoachPrompt — admin-only.
type CreateCoachPrompt struct {
	Repo domain.CoachPromptRepo
}

// Do validates + persists.
func (uc *CreateCoachPrompt) Do(ctx context.Context, in domain.CoachPromptUpsert) (domain.CoachPrompt, error) {
	if err := validateCoachUpsert(in); err != nil {
		return domain.CoachPrompt{}, err
	}
	out, err := uc.Repo.Create(ctx, in)
	if err != nil {
		return domain.CoachPrompt{}, fmt.Errorf("admin.CreateCoachPrompt: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────

// UpdateCoachPrompt — partial-patch UC. Version bumped repo-side.
type UpdateCoachPrompt struct {
	Repo domain.CoachPromptRepo
}

// Do validates patch + delegates to repo.
func (uc *UpdateCoachPrompt) Do(ctx context.Context, id uuid.UUID, patch domain.CoachPromptPatch) (domain.CoachPrompt, error) {
	if id == uuid.Nil {
		return domain.CoachPrompt{}, fmt.Errorf("%w: id required", domain.ErrInvalidInput)
	}
	if err := validateCoachPatch(patch); err != nil {
		return domain.CoachPrompt{}, err
	}
	out, err := uc.Repo.Update(ctx, id, patch)
	if err != nil {
		return domain.CoachPrompt{}, fmt.Errorf("admin.UpdateCoachPrompt: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Deactivate
// ─────────────────────────────────────────────────────────────────────────

// DeactivateCoachPrompt — soft delete.
type DeactivateCoachPrompt struct {
	Repo domain.CoachPromptRepo
}

// Do flips is_active to false.
func (uc *DeactivateCoachPrompt) Do(ctx context.Context, id uuid.UUID) error {
	if id == uuid.Nil {
		return fmt.Errorf("%w: id required", domain.ErrInvalidInput)
	}
	if err := uc.Repo.Deactivate(ctx, id); err != nil {
		return fmt.Errorf("admin.DeactivateCoachPrompt: %w", err)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────

func validateCoachUpsert(in domain.CoachPromptUpsert) error {
	if strings.TrimSpace(in.Slug) == "" {
		return fmt.Errorf("%w: slug required", domain.ErrInvalidInput)
	}
	if strings.TrimSpace(in.Template) == "" {
		return fmt.Errorf("%w: template required", domain.ErrInvalidInput)
	}
	if _, ok := allowedCoachCategories[in.Category]; !ok {
		return fmt.Errorf("%w: invalid category %q", domain.ErrInvalidInput, in.Category)
	}
	if err := validateVariables(in.Variables); err != nil {
		return err
	}
	return nil
}

func validateCoachPatch(p domain.CoachPromptPatch) error {
	if p.Template != nil && strings.TrimSpace(*p.Template) == "" {
		return fmt.Errorf("%w: template cannot be blank", domain.ErrInvalidInput)
	}
	if p.Category != nil {
		if _, ok := allowedCoachCategories[*p.Category]; !ok {
			return fmt.Errorf("%w: invalid category %q", domain.ErrInvalidInput, *p.Category)
		}
	}
	if p.Variables != nil {
		if err := validateVariables(*p.Variables); err != nil {
			return err
		}
	}
	return nil
}

func validateVariables(vars []string) error {
	for _, v := range vars {
		if !variableRE.MatchString(v) {
			return fmt.Errorf("%w: variable %q must match {{name}}", domain.ErrInvalidInput, v)
		}
	}
	return nil
}
