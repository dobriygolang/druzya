package app

import (
	"context"
	"fmt"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// GetLeaderboard returns the top-N leaderboard entries, fairness-watermarked
// (only ai_assist=false pipelines counted). companyID nil ⇢ global ranking.
func (h *Handlers) GetLeaderboard(ctx context.Context, companyID *uuid.UUID, limit int) ([]domain.LeaderboardEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	out, err := h.Leaderboard.Top(ctx, companyID, limit)
	if err != nil {
		return nil, fmt.Errorf("leaderboard.Top: %w", err)
	}
	return out, nil
}
