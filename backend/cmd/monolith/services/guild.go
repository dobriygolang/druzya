package services

import (
	"context"
	"errors"

	guildApp "druz9/guild/app"
	guildDomain "druz9/guild/domain"
	guildInfra "druz9/guild/infra"
	guildPorts "druz9/guild/ports"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewGuild wires the guild + guild-war bounded context.
//
// Read paths are wrapped in a Redis read-through cache (CachedRepo). Write
// paths (Contribute, OnMatchCompleted) flow through invalidation hooks so
// freshness on edit stays sub-second. The cache also caches the global
// top-guilds leaderboard exposed at GET /api/v1/guilds/top.
func NewGuild(d Deps) *Module {
	pg := guildInfra.NewPostgres(d.Pool)
	cached := guildInfra.NewCachedRepo(
		pg,
		guildInfra.NewRedisKV(d.Redis),
		guildInfra.DefaultGuildCacheTTL,
		guildInfra.DefaultTopGuildsCacheTTL,
		d.Log,
	)
	judge0 := guildInfra.NewFakeJudge0()
	clock := guildDomain.RealClock{}

	myGuild := &guildApp.GetMyGuild{Guilds: cached, Wars: pg, Clock: clock}
	get := &guildApp.GetGuild{Guilds: cached, Wars: pg, Clock: clock}
	war := &guildApp.GetWar{Guilds: cached, Wars: pg, Clock: clock}
	contribute := &guildApp.Contribute{
		Guilds: cached, Wars: pg, Judge0: judge0,
		GetWar: war, Clock: clock, Log: d.Log,
	}
	topUC := &guildApp.ListTopGuilds{Guilds: cached}
	onMatch := &guildApp.OnMatchCompleted{Guilds: cached, Log: d.Log}
	server := guildPorts.NewGuildServer(myGuild, get, war, contribute, d.Log)
	topHandler := &guildPorts.TopGuildsHandler{UC: topUC, Log: d.Log}

	connectPath, connectHandler := druz9v1connect.NewGuildServiceHandler(server)
	transcoder := mustTranscode("guild", connectPath, connectHandler)

	// cacheInvalidator is hung off the shared bus alongside OnMatchCompleted
	// (which handles the seed-bump concern). When a match ends, every
	// participant's guild — and the global top-list — may have shifted, so
	// we nuke the per-guild keys plus the small fixed set of top-N entries.
	// Two subscribers on one topic is fine; sharedDomain fans out.
	cacheInvalidator := func(ctx context.Context, e sharedDomain.Event) error {
		ev, ok := e.(sharedDomain.MatchCompleted)
		if !ok {
			return errors.New("guild.cacheInvalidator: unexpected event type")
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
			r.Get("/guild/my", transcoder.ServeHTTP)
			r.Get("/guild/{guildId}", transcoder.ServeHTTP)
			r.Get("/guild/{guildId}/war", transcoder.ServeHTTP)
			r.Post("/guild/{guildId}/war/contribute", transcoder.ServeHTTP)
			// Top-guilds is a bare REST endpoint (no Connect contract yet).
			// Mounted on the /api/v1 router; auth is required by the parent
			// chain (the leaderboard sits behind requireAuth like /guild/*).
			r.Get("/guilds/top", topHandler.ServeHTTP)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) {
				guildApp.SubscribeHandlers(b, onMatch)
				b.Subscribe(sharedDomain.MatchCompleted{}.Topic(), cacheInvalidator)
			},
		},
	}
}
