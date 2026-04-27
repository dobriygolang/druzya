package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"
)

// CreateCodexArticle inserts a codex article.
type CreateCodexArticle struct {
	Codex domain.CodexRepo
}

// Do validates required fields and inserts.
func (uc *CreateCodexArticle) Do(ctx context.Context, in domain.CodexArticleUpsert) (domain.CodexArticle, error) {
	if in.Slug == "" || in.Title == "" || in.Category == "" || in.Href == "" {
		return domain.CodexArticle{}, fmt.Errorf("admin.CreateCodexArticle: %w: %w",
			domain.ErrInvalidInput,
			errors.New("slug, title, category, href are required"))
	}
	out, err := uc.Codex.CreateArticle(ctx, in)
	if err != nil {
		return domain.CodexArticle{}, fmt.Errorf("admin.CreateCodexArticle: %w", err)
	}
	return out, nil
}
