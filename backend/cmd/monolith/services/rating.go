package services

import (
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

	getMyRatings := &ratingApp.GetMyRatings{Ratings: pg}
	getLeaderboard := &ratingApp.GetLeaderboard{
		Ratings: pg, Cache: cache, Log: d.Log, TTL: 60 * time.Second,
	}
	server := ratingPorts.NewRatingServer(getMyRatings, getLeaderboard, d.Log)
	onMatchCompleted := &ratingApp.OnMatchCompleted{Ratings: pg, Bus: d.Bus, Log: d.Log}
	onKataCompleted := &ratingApp.OnDailyKataCompleted{Ratings: pg, Bus: d.Bus, Log: d.Log}

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
		},
	}
}
