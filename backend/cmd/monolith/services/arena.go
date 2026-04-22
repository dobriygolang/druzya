package services

import (
	"context"
	"os"
	"strings"

	arenaApp "druz9/arena/app"
	arenaDomain "druz9/arena/domain"
	arenaInfra "druz9/arena/infra"
	arenaPorts "druz9/arena/ports"
	ratingInfra "druz9/rating/infra"
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewArena wires the arena bounded context: matchmaking queue, ready-check,
// code submission, anti-cheat hooks and the WebSocket hub. The matchmaker
// goroutine is registered via Background; its stop closure runs in
// Shutdown so the parent ctx propagates cleanly.
//
// rating's Postgres repo is required so arena can read each player's
// per-section ELO without importing rating's app layer.
func NewArena(d Deps, ratingRepo *ratingInfra.Postgres) *Module {
	pg := arenaInfra.NewPostgres(d.Pool)
	rdb := arenaInfra.NewRedis(d.Redis)
	judge0 := arenaInfra.NewFakeJudge0()
	clock := arenaDomain.RealClock{}
	verifier := arenaTokenVerifier{issuer: d.TokenIssuer}
	allowedOrigins := strings.Split(os.Getenv("WS_ALLOWED_ORIGINS"), ",")
	hub := arenaPorts.NewHub(d.Log, verifier, allowedOrigins)

	find := &arenaApp.FindMatch{Queue: rdb, Clock: clock}
	cancelUC := &arenaApp.CancelSearch{Queue: rdb}
	get := &arenaApp.GetMatch{Matches: pg, Tasks: pg}
	confirm := &arenaApp.ConfirmReady{
		Matches: pg, Ready: rdb, Bus: d.Bus,
		Notifier: hub, Clock: clock, Log: d.Log,
	}
	timeouts := &arenaApp.HandleReadyCheckTimeout{
		Queue: rdb, Matches: pg, Ready: rdb,
		Bus: d.Bus, Clock: clock, Log: d.Log,
	}
	submit := &arenaApp.SubmitCode{
		Matches: pg, Tasks: pg, Judge0: judge0,
		Anticheat: rdb, Bus: d.Bus, Clock: clock, Log: d.Log,
	}
	paste := &arenaApp.OnPasteAttempt{Anticheat: rdb, Bus: d.Bus}
	tab := &arenaApp.OnTabSwitch{Anticheat: rdb, Bus: d.Bus}
	hub.OnPaste = func(ctx context.Context, matchID, userID uuid.UUID) {
		_ = paste.Apply(ctx, matchID, userID)
	}
	hub.OnTab = func(ctx context.Context, matchID, userID uuid.UUID) {
		_ = tab.Apply(ctx, matchID, userID)
	}

	eloFn := arenaPorts.UserEloFunc(func(ctx any, userID uuid.UUID, section enums.Section) int {
		c, _ := ctx.(context.Context)
		if c == nil {
			c = context.Background()
		}
		list, err := ratingRepo.List(c, userID)
		if err != nil {
			return arenaDomain.InitialELO
		}
		for _, r := range list {
			if r.Section == section {
				return r.Elo
			}
		}
		return arenaDomain.InitialELO
	})
	server := arenaPorts.NewArenaServer(
		find, cancelUC, confirm, submit, get, timeouts, eloFn, d.Log,
	)
	matchmaker := arenaApp.NewMatchmaker(
		rdb, rdb, pg, pg, d.Bus, hub, clock, d.Log,
	)

	connectPath, connectHandler := druz9v1connect.NewArenaServiceHandler(server)
	transcoder := mustTranscode("arena", connectPath, connectHandler)

	// Matchmaker.Start is synchronous (returns a stop closure immediately
	// and runs the dispatcher on a goroutine). We capture stopFn from
	// inside Background so it's available at Shutdown time.
	var stopFn func()

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/arena/match/find", transcoder.ServeHTTP)
			r.Delete("/arena/match/cancel", transcoder.ServeHTTP)
			r.Get("/arena/match/{matchId}", transcoder.ServeHTTP)
			r.Post("/arena/match/{matchId}/confirm", transcoder.ServeHTTP)
			r.Post("/arena/match/{matchId}/submit", transcoder.ServeHTTP)
		},
		MountWS: func(ws chi.Router) {
			ws.Get("/arena/{matchId}", hub.WSHandler)
		},
		Background: []func(ctx context.Context){
			func(ctx context.Context) { stopFn = matchmaker.Start(ctx) },
		},
		Shutdown: []func(ctx context.Context) error{
			func(ctx context.Context) error {
				if stopFn != nil {
					stopFn()
				}
				return nil
			},
		},
	}
}
