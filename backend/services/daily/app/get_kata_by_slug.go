package app

import (
	"context"
	"fmt"

	"druz9/daily/domain"
)

// GetKataBySlug implements GET /daily/kata/:slug. It's a straight repo
// passthrough — no user-specific state (assignments, streak, freeze) is
// involved because the slug route is a *deep-link* view, not a grading
// surface. Anti-fallback: an unknown slug returns domain.ErrNotFound and the
// transport layer surfaces that as HTTP 404 — we never silently fall back to
// today's kata.
type GetKataBySlug struct {
	Tasks domain.TaskRepo
}

// Do returns the task matching the slug or domain.ErrNotFound.
func (uc *GetKataBySlug) Do(ctx context.Context, slug string) (domain.TaskPublic, error) {
	if slug == "" {
		return domain.TaskPublic{}, fmt.Errorf("daily.GetKataBySlug: %w", domain.ErrNotFound)
	}
	t, err := uc.Tasks.GetBySlug(ctx, slug)
	if err != nil {
		return domain.TaskPublic{}, fmt.Errorf("daily.GetKataBySlug: %w", err)
	}
	return t, nil
}
