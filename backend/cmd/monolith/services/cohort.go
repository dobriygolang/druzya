package services

import (
	"context"
	"errors"

	cohortApp "druz9/cohort/app"
	cohortDomain "druz9/cohort/domain"
	cohortInfra "druz9/cohort/infra"
	cohortPorts "druz9/cohort/ports"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewCohort wires the cohort + cohort-war bounded context.
//
// Read paths are wrapped in a Redis read-through cache (CachedRepo). Write
// paths (Contribute, OnMatchCompleted) flow through invalidation hooks so
// freshness on edit stays sub-second. The cache also caches the global
// top-cohorts leaderboard exposed at GET /api/v1/cohorts/top.
func NewCohort(d Deps) *Module {
	pg := cohortInfra.NewPostgres(d.Pool)
	cached := cohortInfra.NewCachedRepo(
		pg,
		cohortInfra.NewRedisKV(d.Redis),
		cohortInfra.DefaultCohortCacheTTL,
		cohortInfra.DefaultTopCohortsCacheTTL,
		d.Log,
	)
	judge0 := cohortInfra.NewFakeJudge0()
	clock := cohortDomain.RealClock{}

	myCohort := &cohortApp.GetMyCohort{Cohorts: cached, Wars: pg, Clock: clock}
	get := &cohortApp.GetCohort{Cohorts: cached, Wars: pg, Clock: clock}
	war := &cohortApp.GetWar{Cohorts: cached, Wars: pg, Clock: clock}
	contribute := &cohortApp.Contribute{
		Cohorts: cached, Wars: pg, Judge0: judge0,
		GetWar: war, Clock: clock, Log: d.Log,
	}
	topUC := &cohortApp.ListTopCohorts{Cohorts: cached}
	onMatch := &cohortApp.OnMatchCompleted{Cohorts: cached, Log: d.Log}
	server := cohortPorts.NewCohortServer(myCohort, get, war, contribute, topUC, d.Log)

	// /cohort/list, POST /cohort, /join, /leave — chi REST handlers (Wave 3).
	// The Discovery surface lives outside the proto contract (same rationale
	// as daily/run): tiny CRUD-y endpoints with UI-tailored shapes; adding a
	// proto would force a regen for what is essentially plumbing. The cache
	// invalidation hooks reuse the existing CachedRepo so /cohort/my and the
	// top-list stay sub-second fresh post-mutation.
	discovery := cohortPorts.NewDiscoveryHandler(d.Pool, cached, d.Log)

	connectPath, connectHandler := druz9v1connect.NewCohortServiceHandler(server)
	transcoder := mustTranscode("cohort", connectPath, connectHandler)

	// cacheInvalidator is hung off the shared bus alongside OnMatchCompleted
	// (which handles the seed-bump concern). When a match ends, every
	// participant's cohort — and the global top-list — may have shifted, so
	// we nuke the per-cohort keys plus the small fixed set of top-N entries.
	// Two subscribers on one topic is fine; sharedDomain fans out.
	cacheInvalidator := func(ctx context.Context, e sharedDomain.Event) error {
		ev, ok := e.(sharedDomain.MatchCompleted)
		if !ok {
			return errors.New("cohort.cacheInvalidator: unexpected event type")
		}
		ids := make([]uuid.UUID, 0, 1+len(ev.LoserIDs))
		ids = append(ids, ev.WinnerID)
		ids = append(ids, ev.LoserIDs...)
		cached.InvalidateMatchParticipants(ctx, ids...)
		return nil
	}

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// Discovery surface — these MUST be registered before the catch-all
			// /cohort/{cohortId} route below, otherwise chi will route /cohort/list
			// into GetCohort and 400 on the bad UUID.
			r.Get("/cohort/list", discovery.HandleList)
			r.Post("/cohort", discovery.HandleCreate)
			r.Post("/cohort/{cohortId}/join", discovery.HandleJoin)
			r.Post("/cohort/{cohortId}/leave", discovery.HandleLeave)

			r.Get("/cohort/my", transcoder.ServeHTTP)
			r.Get("/cohort/{cohortId}", transcoder.ServeHTTP)
			r.Get("/cohort/{cohortId}/war", transcoder.ServeHTTP)
			r.Post("/cohort/{cohortId}/war/contribute", transcoder.ServeHTTP)
			// Top-cohorts теперь Connect-RPC ListTopCohorts через transcoder.
			// Раньше был отдельный chi-route → удалён.
			r.Get("/cohorts/top", transcoder.ServeHTTP)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) {
				cohortApp.SubscribeHandlers(b, onMatch)
				b.Subscribe(sharedDomain.MatchCompleted{}.Topic(), cacheInvalidator)
			},
		},
	}
}
