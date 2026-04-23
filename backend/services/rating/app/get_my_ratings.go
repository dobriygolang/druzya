package app

import (
	"context"
	"fmt"
	"time"

	"druz9/rating/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// MySectionRating is the projected per-section row passed to ports.
type MySectionRating struct {
	Section      string
	Elo          int
	MatchesCount int
	Percentile   int
	Decaying     bool
}

// MyRatingsView is what ports serialises for GET /rating/me.
type MyRatingsView struct {
	Ratings          []MySectionRating
	GlobalPowerScore int
}

// GetMyRatings is the use case for GET /rating/me.
type GetMyRatings struct {
	Ratings domain.RatingRepo
}

// Do loads the user's ratings and derives global score + percentiles.
//
// Percentile is computed per-section as round((1 - (rank-1)/total) * 100),
// i.e. the fraction of ranked users the caller is ahead of (the user at
// rank=1 reports 100, rank=total reports 0). Sections with total <= 1 are
// reported as 100 (the user is the only ranked competitor). FindRank or
// CountSection failures propagate — we never fall back to a hard-coded
// stand-in percentile (anti-fallback policy).
func (uc *GetMyRatings) Do(ctx context.Context, userID uuid.UUID) (MyRatingsView, error) {
	list, err := uc.Ratings.List(ctx, userID)
	if err != nil {
		return MyRatingsView{}, fmt.Errorf("rating.GetMyRatings: list: %w", err)
	}
	out := MyRatingsView{
		GlobalPowerScore: domain.ComputeGlobalPowerScore(list),
		Ratings:          make([]MySectionRating, 0, len(list)),
	}
	now := time.Now().UTC()
	for _, r := range list {
		decaying := r.LastMatchAt != nil && now.Sub(*r.LastMatchAt) > 7*24*time.Hour
		pct, perr := uc.percentile(ctx, userID, r.Section)
		if perr != nil {
			return MyRatingsView{}, fmt.Errorf("rating.GetMyRatings: percentile: %w", perr)
		}
		out.Ratings = append(out.Ratings, MySectionRating{
			Section:      string(r.Section),
			Elo:          r.Elo,
			MatchesCount: r.MatchesCount,
			Percentile:   pct,
			Decaying:     decaying,
		})
	}
	return out, nil
}

// percentile resolves rank + section size and converts to a 0..100 score.
func (uc *GetMyRatings) percentile(ctx context.Context, userID uuid.UUID, section enums.Section) (int, error) {
	rank, err := uc.Ratings.FindRank(ctx, userID, section)
	if err != nil {
		return 0, err
	}
	total, err := uc.Ratings.CountSection(ctx, section)
	if err != nil {
		return 0, err
	}
	if rank <= 0 || total <= 0 {
		return 0, nil
	}
	if total <= 1 {
		return 100, nil
	}
	// (rank-1) users are above the caller; (total-rank) are below.
	// Percentile = share of users strictly below, scaled to 0..100.
	below := total - rank
	pct := (below * 100) / (total - 1)
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return pct, nil
}
