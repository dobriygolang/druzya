package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

// GetCodexArticleMeta fetches the slug/title/category needed to record a
// `codex_article_opened` coach episode.
type GetCodexArticleMeta struct {
	Codex domain.CodexRepo
}

// Do returns the article meta if active.
func (uc *GetCodexArticleMeta) Do(ctx context.Context, id uuid.UUID) (domain.CodexArticleMeta, error) {
	out, err := uc.Codex.GetArticleMetaIfActive(ctx, id)
	if err != nil {
		return domain.CodexArticleMeta{}, fmt.Errorf("admin.GetCodexArticleMeta: %w", err)
	}
	return out, nil
}
