package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

// DeleteCodexArticle removes a codex article.
type DeleteCodexArticle struct {
	Codex domain.CodexRepo
}

// Do removes the row.
func (uc *DeleteCodexArticle) Do(ctx context.Context, id uuid.UUID) error {
	if err := uc.Codex.DeleteArticle(ctx, id); err != nil {
		return fmt.Errorf("admin.DeleteCodexArticle: %w", err)
	}
	return nil
}
