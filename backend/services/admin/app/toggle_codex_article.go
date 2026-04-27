package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

// ToggleCodexArticle flips the `active` flag on an article.
type ToggleCodexArticle struct {
	Codex domain.CodexRepo
}

// Do sets active to the explicit value.
func (uc *ToggleCodexArticle) Do(ctx context.Context, id uuid.UUID, active bool) error {
	if err := uc.Codex.SetArticleActive(ctx, id, active); err != nil {
		return fmt.Errorf("admin.ToggleCodexArticle: %w", err)
	}
	return nil
}
