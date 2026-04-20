package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// ListAnticheat implements GET /api/v1/admin/anticheat.
//
// STUB: bulk actions over the selection (e.g. "flag all as false positive",
// "invalidate matching matches") are not wired for MVP — curators eyeball
// the dashboard and act through the single-row endpoints in each domain.
type ListAnticheat struct {
	Anticheat domain.AnticheatRepo
}

// Do returns a filtered list of anticheat signals, newest first.
func (uc *ListAnticheat) Do(ctx context.Context, f domain.AnticheatFilter) ([]domain.AnticheatSignal, error) {
	out, err := uc.Anticheat.List(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("admin.ListAnticheat: %w", err)
	}
	return out, nil
}
