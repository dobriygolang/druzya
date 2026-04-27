package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// ListCodexCategories serves both the public read (activeOnly=true) and
// the admin listing (activeOnly=false).
type ListCodexCategories struct {
	Codex domain.CodexRepo
}

// Do returns codex categories.
func (uc *ListCodexCategories) Do(ctx context.Context, activeOnly bool) ([]domain.CodexCategory, error) {
	out, err := uc.Codex.ListCategories(ctx, activeOnly)
	if err != nil {
		return nil, fmt.Errorf("admin.ListCodexCategories: %w", err)
	}
	return out, nil
}
