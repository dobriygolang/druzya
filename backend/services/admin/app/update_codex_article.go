package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

// UpdateCodexArticle updates a codex article.
type UpdateCodexArticle struct {
	Codex domain.CodexRepo
}

// Do validates and updates.
func (uc *UpdateCodexArticle) Do(ctx context.Context, id uuid.UUID, in domain.CodexArticleUpsert) (domain.CodexArticle, error) {
	if in.Slug == "" || in.Title == "" || in.Category == "" || in.Href == "" {
		return domain.CodexArticle{}, fmt.Errorf("admin.UpdateCodexArticle: %w: %w",
			domain.ErrInvalidInput,
			errors.New("slug, title, category, href are required"))
	}
	out, err := uc.Codex.UpdateArticle(ctx, id, in)
	if err != nil {
		return domain.CodexArticle{}, fmt.Errorf("admin.UpdateCodexArticle: %w", err)
	}
	return out, nil
}
