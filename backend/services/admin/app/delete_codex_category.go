package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"
)

// ErrCategoryInUse is returned when DeleteCodexCategory is called for a
// slug that still has articles attached. Carries the count for the error
// message.
type ErrCategoryInUse struct {
	Slug  string
	Count int
}

// Error satisfies the error interface.
func (e *ErrCategoryInUse) Error() string {
	return fmt.Sprintf("category %q still has %d article(s)", e.Slug, e.Count)
}

// DeleteCodexCategory removes a category, refusing if articles still
// reference it.
type DeleteCodexCategory struct {
	Codex domain.CodexRepo
}

// Do refuses if articles still reference the slug.
func (uc *DeleteCodexCategory) Do(ctx context.Context, slug string) error {
	if slug == "" {
		return fmt.Errorf("admin.DeleteCodexCategory: %w: %w",
			domain.ErrInvalidInput,
			errors.New("slug required"))
	}
	count, err := uc.Codex.CountArticlesByCategory(ctx, slug)
	if err == nil && count > 0 {
		return fmt.Errorf("admin.DeleteCodexCategory: %w",
			&ErrCategoryInUse{Slug: slug, Count: count})
	}
	if err := uc.Codex.DeleteCategory(ctx, slug); err != nil {
		return fmt.Errorf("admin.DeleteCodexCategory: %w", err)
	}
	return nil
}
