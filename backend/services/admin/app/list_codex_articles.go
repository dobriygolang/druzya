package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// ListCodexArticles serves both the public read (activeOnly=true) and the
// admin listing (activeOnly=false).
type ListCodexArticles struct {
	Codex domain.CodexRepo
}

// Do returns codex articles.
func (uc *ListCodexArticles) Do(ctx context.Context, activeOnly bool) ([]domain.CodexArticle, error) {
	out, err := uc.Codex.ListArticles(ctx, activeOnly)
	if err != nil {
		return nil, fmt.Errorf("admin.ListCodexArticles: %w", err)
	}
	return out, nil
}
