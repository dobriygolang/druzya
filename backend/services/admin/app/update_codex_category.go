package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"
)

// UpdateCodexCategory updates a codex category by slug.
type UpdateCodexCategory struct {
	Codex domain.CodexRepo
}

// Do validates and updates.
func (uc *UpdateCodexCategory) Do(ctx context.Context, slug string, in domain.CodexCategory) error {
	if slug == "" {
		return fmt.Errorf("admin.UpdateCodexCategory: %w: %w",
			domain.ErrInvalidInput,
			errors.New("slug required"))
	}
	if err := uc.Codex.UpdateCategory(ctx, slug, in); err != nil {
		return fmt.Errorf("admin.UpdateCodexCategory: %w", err)
	}
	return nil
}
