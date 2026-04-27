package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"
)

// CreateCodexCategory inserts a codex category.
type CreateCodexCategory struct {
	Codex domain.CodexRepo
}

// Do validates and inserts.
func (uc *CreateCodexCategory) Do(ctx context.Context, in domain.CodexCategory) error {
	if in.Slug == "" || in.Label == "" {
		return fmt.Errorf("admin.CreateCodexCategory: %w: %w",
			domain.ErrInvalidInput,
			errors.New("slug and label are required"))
	}
	if err := uc.Codex.CreateCategory(ctx, in); err != nil {
		return fmt.Errorf("admin.CreateCodexCategory: %w", err)
	}
	return nil
}
