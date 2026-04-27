package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// PublicStats serves GET /api/v1/stats/public.
type PublicStats struct {
	Stats domain.StatsRepo
}

// Do returns the headline counters.
func (uc *PublicStats) Do(ctx context.Context) (domain.PublicStats, error) {
	out, err := uc.Stats.PublicStats(ctx)
	if err != nil {
		return domain.PublicStats{}, fmt.Errorf("admin.PublicStats: %w", err)
	}
	return out, nil
}
