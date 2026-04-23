package services

import (
	"context"
	"fmt"
	"os"
	"strings"

	arenaApp "druz9/arena/app"
	arenaDomain "druz9/arena/domain"
	arenaInfra "druz9/arena/infra"
	arenaPorts "druz9/arena/ports"
	ratingInfra "druz9/rating/infra"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"

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

	// Match-history is a hot read after every match end; wrap the repo in a
	// 30s read-through Redis cache + per-user invalidation epoch. The
	// loader closes over `pg` so domain stays unaware of caching.
	kv := arenaInfra.NewRedisKV(d.Redis)
	historyCache := arenaInfra.NewMatchHistoryCache(
		kv,
		arenaInfra.DefaultMatchHistoryTTL,
		d.Log,
		func(ctx context.Context, userID uuid.UUID, f arenaInfra.MatchHistoryFilters) (arenaInfra.MatchHistorySnapshot, error) {
			items, total, err := pg.ListByUser(ctx, userID, f.Limit, f.Offset, f.Mode, f.Section)
			if err != nil {
				return arenaInfra.MatchHistorySnapshot{}, fmt.Errorf("arena.history loader: %w", err)
			}
			return arenaInfra.MatchHistorySnapshot{Items: items, Total: total}, nil
		},
	)
	historyRepo := arenaInfra.NewCachedHistoryRepo(pg, historyCache)
	getHistory := &arenaApp.GetMyMatches{Matches: historyRepo}

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
		find, cancelUC, confirm, submit, get, getHistory, timeouts, eloFn, d.Log,
	)
	matchmaker := arenaApp.NewMatchmaker(
		rdb, rdb, pg, pg, d.Bus, hub, clock, d.Log,
	)

	// Practice mode is a chi-direct REST route (no proto contract yet — see
	// ports/practice.go for the rationale). Wired below alongside the
	// transcoded /arena/match/* routes.
	practiceUC := &arenaApp.StartPractice{Matches: pg, Tasks: pg, Clock: clock}
	practice := arenaPorts.NewPracticeHandler(practiceUC, eloFn)

	// Current-match polling endpoint — the SPA polls /arena/match/current
	// every 2s while the user is in the matchmaking queue and navigates to
	// /arena/match/:id as soon as it returns 200. Chi-direct (no proto).
	currentMatch := arenaPorts.NewCurrentMatchHandler(pg, d.Log)

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
			// /arena/match/current MUST be registered BEFORE /arena/match/{matchId}
			// — chi matches routes in declaration order and "current" would
			// otherwise be eaten by the {matchId} pattern.
			r.Get("/arena/match/current", currentMatch.ServeHTTP)
			r.Get("/arena/match/{matchId}", transcoder.ServeHTTP)
			r.Post("/arena/match/{matchId}/confirm", transcoder.ServeHTTP)
			r.Post("/arena/match/{matchId}/submit", transcoder.ServeHTTP)
			// /matches/my теперь Connect-RPC GetMyMatches — идёт через тот
			// же transcoder. Раньше был отдельный chi-route → удалён.
			r.Get("/arena/matches/my", transcoder.ServeHTTP)
			// Practice — instant single-player match against an AI opponent.
			// Chi-direct (no proto), see ports/practice.go.
			r.Post("/arena/practice", practice.ServeHTTP)
		},
		MountWS: func(ws chi.Router) {
			ws.Get("/arena/{matchId}", hub.WSHandler)
		},
		Subscribers: []func(*eventbus.InProcess){
			// On match completion, drop the cached history pages for the
			// participants involved so the next /match-history fetch sees
			// the new row immediately. Cancellation also affects history.
			func(bus *eventbus.InProcess) {
				bus.Subscribe(sharedDomain.MatchCompleted{}.Topic(), func(ctx context.Context, e sharedDomain.Event) error {
					ev, ok := e.(sharedDomain.MatchCompleted)
					if !ok {
						return nil
					}
					historyCache.Invalidate(ctx, ev.WinnerID)
					for _, l := range ev.LoserIDs {
						historyCache.Invalidate(ctx, l)
					}
					return nil
				})
				bus.Subscribe(sharedDomain.MatchCancelled{}.Topic(), func(ctx context.Context, e sharedDomain.Event) error {
					ev, ok := e.(sharedDomain.MatchCancelled)
					if !ok {
						return nil
					}
					// Best-effort: load participants and invalidate each one.
					parts, perr := pg.ListParticipants(ctx, ev.MatchID)
					if perr != nil {
						return nil
					}
					for _, p := range parts {
						historyCache.Invalidate(ctx, p.UserID)
					}
					return nil
				})
			},
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
