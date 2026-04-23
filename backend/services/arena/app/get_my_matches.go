// Package app — use case for the /match-history page.
//
// GetMyMatches is intentionally thin: it normalises the page window
// (limit/offset clamps live in the domain so they're trivially testable),
// asks the repo for one paginated page and returns the rows + total. All
// formatting (avatar fallback, "vs @user" labels, time-ago strings) is the
// frontend's job — we keep the wire shape flat and stable.
package app

import (
	"context"
	"fmt"

	"druz9/arena/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// GetMyMatches returns the caller's match history page.
type GetMyMatches struct {
	Matches domain.MatchRepo
}

// GetMyMatchesInput is the input shape for GetMyMatches.Do.
type GetMyMatchesInput struct {
	UserID  uuid.UUID
	Limit   int
	Offset  int
	Mode    enums.ArenaMode // "" = no filter
	Section enums.Section   // "" = no filter
}

// GetMyMatchesOutput holds the page + the unfiltered total (under filter).
type GetMyMatchesOutput struct {
	Items []domain.MatchHistoryEntry
	Total int
}

// Do runs the use case. Repo errors are wrapped with the standard
// "arena.GetMyMatches: %w" prefix so the ports layer can do errors.Is on
// the same sentinels as every other use case.
func (uc *GetMyMatches) Do(ctx context.Context, in GetMyMatchesInput) (GetMyMatchesOutput, error) {
	limit := domain.ClampHistoryLimit(in.Limit)
	offset := domain.ClampHistoryOffset(in.Offset)

	// Validate filters when set — an unknown mode/section should never reach
	// the repo (defence in depth: the wire layer also rejects invalid enums).
	if in.Mode != "" && !in.Mode.IsValid() {
		return GetMyMatchesOutput{}, fmt.Errorf("arena.GetMyMatches: invalid mode %q", in.Mode)
	}
	if in.Section != "" && !in.Section.IsValid() {
		return GetMyMatchesOutput{}, fmt.Errorf("arena.GetMyMatches: invalid section %q", in.Section)
	}

	items, total, err := uc.Matches.ListByUser(ctx, in.UserID, limit, offset, in.Mode, in.Section)
	if err != nil {
		return GetMyMatchesOutput{}, fmt.Errorf("arena.GetMyMatches: %w", err)
	}
	if items == nil {
		items = []domain.MatchHistoryEntry{}
	}
	return GetMyMatchesOutput{Items: items, Total: total}, nil
}
