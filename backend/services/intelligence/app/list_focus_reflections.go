// list_focus_reflections.go — H2 (Phase J 2026-05-12).
//
// Read-side UC for /stats grade-trend chart. Returns reflections within
// window_days newest-first. Default window 30d, hard cap 365.
package app

import (
	"context"
	"fmt"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// ListFocusReflections UC.
type ListFocusReflections struct {
	Repo domain.FocusReflectionRepo
}

// ListFocusReflectionsInput.
type ListFocusReflectionsInput struct {
	UserID     uuid.UUID
	WindowDays int
}

// ListFocusReflectionsResult.
type ListFocusReflectionsResult struct {
	Items []domain.FocusReflection
}

// Do reads paginated list newest-first.
func (uc *ListFocusReflections) Do(ctx context.Context, in ListFocusReflectionsInput) (ListFocusReflectionsResult, error) {
	if in.UserID == uuid.Nil {
		return ListFocusReflectionsResult{}, fmt.Errorf("intelligence.ListFocusReflections: %w: zero user_id", domain.ErrInvalidInput)
	}
	window := in.WindowDays
	if window <= 0 {
		window = 30
	}
	if window > 365 {
		window = 365
	}
	rows, err := uc.Repo.ListRecent(ctx, in.UserID, window)
	if err != nil {
		return ListFocusReflectionsResult{}, fmt.Errorf("intelligence.ListFocusReflections: %w", err)
	}
	return ListFocusReflectionsResult{Items: rows}, nil
}
