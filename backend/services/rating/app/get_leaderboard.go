package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/rating/domain"
	"druz9/shared/enums"
)

// LeaderboardView is what ports serialises for GET /rating/leaderboard.
type LeaderboardView struct {
	Section   string
	Entries   []domain.LeaderboardEntry
	MyRank    int
	UpdatedAt time.Time
}

// GetLeaderboard is the cache-through use case for GET /rating/leaderboard.
type GetLeaderboard struct {
	Ratings domain.RatingRepo
	Cache   domain.LeaderboardCache
	Log     *slog.Logger
	// TTL for a cache entry. Bible §3.6 says 60s.
	TTL time.Duration
}

// Do checks the cache, falls back to Postgres, and backfills.
func (uc *GetLeaderboard) Do(ctx context.Context, section string, limit int) (LeaderboardView, error) {
	sec := enums.Section(section)
	if !sec.IsValid() {
		return LeaderboardView{}, fmt.Errorf("rating.GetLeaderboard: invalid section %q", section)
	}
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	if uc.Cache != nil {
		if cached, ok, err := uc.Cache.Get(ctx, sec, limit); err == nil && ok {
			return LeaderboardView{
				Section:   section,
				Entries:   cached,
				UpdatedAt: time.Now().UTC(),
			}, nil
		} else if err != nil {
			uc.Log.WarnContext(ctx, "rating.GetLeaderboard: cache.get", slog.Any("err", err))
		}
	}
	entries, err := uc.Ratings.Top(ctx, sec, limit)
	if err != nil {
		return LeaderboardView{}, fmt.Errorf("rating.GetLeaderboard: pg top: %w", err)
	}
	if uc.Cache != nil {
		ttl := uc.TTL
		if ttl == 0 {
			ttl = 60 * time.Second
		}
		if perr := uc.Cache.Put(ctx, sec, entries, ttl); perr != nil {
			uc.Log.WarnContext(ctx, "rating.GetLeaderboard: cache.put", slog.Any("err", perr))
		}
	}
	return LeaderboardView{
		Section:   section,
		Entries:   entries,
		UpdatedAt: time.Now().UTC(),
	}, nil
}
