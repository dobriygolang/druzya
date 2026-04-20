package app

import (
	"context"
	"fmt"
	"time"

	"druz9/rating/domain"

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
// Percentile is left at 50 as a STUB until a cache-backed rank query is wired.
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
		out.Ratings = append(out.Ratings, MySectionRating{
			Section:      string(r.Section),
			Elo:          r.Elo,
			MatchesCount: r.MatchesCount,
			// STUB: percentile derivation — needs rank / section_size from cache.
			Percentile: 50,
			Decaying:   decaying,
		})
	}
	return out, nil
}
