package services

import (
	"context"
	"os"
	"strconv"
	"time"

	ratingApp "druz9/rating/app"
	ratingInfra "druz9/rating/infra"
	ratingPorts "druz9/rating/ports"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
)

// RatingModule exposes the underlying Postgres repo so arena can look up
// each player's per-section ELO without dragging in the whole rating wiring.
type RatingModule struct {
	Module
	Repo *ratingInfra.Postgres
}

// NewRating wires the rating bounded context. Leaderboard is cached in
// Redis with a 60s TTL — keep this matched between calls if you ever
// extract the cache into config.
func NewRating(d Deps) *RatingModule {
	pg := ratingInfra.NewPostgres(d.Pool)
	cache := ratingInfra.NewRedisLeaderboard(d.Redis)

	// Phase 2: wrap the Postgres repo in the read-through my-ratings cache.
	// Writes (Upsert via OnMatchCompleted / OnDailyKataCompleted) flow
	// through the wrapper and Invalidate the user's key.
	myCache := ratingInfra.NewCachedRepo(pg, ratingInfra.NewRedisKV(d.Redis), 60*time.Second, d.Log)

	// Leaderboard recompute worker — interval is configurable via env so
	// ops can dial it down in incidents without a restart-loop.
	interval := ratingInfra.DefaultRecomputeInterval
	if v := os.Getenv("RATING_LEADERBOARD_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			interval = d
		} else if secs, err := strconv.Atoi(v); err == nil && secs > 0 {
			interval = time.Duration(secs) * time.Second
		}
	}
	worker := ratingInfra.NewLeaderboardRecomputeWorker(
		pg, ratingInfra.NewRedisZSetClient(d.Redis), d.Log, interval, ratingInfra.DefaultRecomputeLimit,
	)

	getMyRatings := &ratingApp.GetMyRatings{Ratings: myCache}
	getLeaderboard := &ratingApp.GetLeaderboard{
		Ratings: pg, Cache: cache, Log: d.Log, TTL: 60 * time.Second,
	}
	server := ratingPorts.NewRatingServer(getMyRatings, getLeaderboard, d.Log)
	onMatchCompleted := &ratingApp.OnMatchCompleted{Ratings: myCache, Bus: d.Bus, Log: d.Log}
	onKataCompleted := &ratingApp.OnDailyKataCompleted{Ratings: myCache, Bus: d.Bus, Log: d.Log}

	connectPath, connectHandler := druz9v1connect.NewRatingServiceHandler(server)
	transcoder := mustTranscode("rating", connectPath, connectHandler)

	return &RatingModule{
		Repo: pg,
		Module: Module{
			ConnectPath:        connectPath,
			ConnectHandler:     transcoder,
			RequireConnectAuth: true,
			MountREST: func(r chi.Router) {
				r.Get("/rating/me", transcoder.ServeHTTP)
				r.Get("/rating/leaderboard", transcoder.ServeHTTP)
			},
			Subscribers: []func(*eventbus.InProcess){
				func(b *eventbus.InProcess) {
					b.Subscribe(sharedDomain.MatchCompleted{}.Topic(), onMatchCompleted.Handle)
					b.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), onKataCompleted.Handle)
				},
			},
			Background: []func(ctx context.Context){
				func(ctx context.Context) { go worker.Run(ctx) },
			},
		},
	}
}
