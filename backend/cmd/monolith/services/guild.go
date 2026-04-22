package services

import (
	guildApp "druz9/guild/app"
	guildDomain "druz9/guild/domain"
	guildInfra "druz9/guild/infra"
	guildPorts "druz9/guild/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
)

// NewGuild wires the guild + guild-war bounded context.
func NewGuild(d Deps) *Module {
	pg := guildInfra.NewPostgres(d.Pool)
	judge0 := guildInfra.NewFakeJudge0()
	clock := guildDomain.RealClock{}

	myGuild := &guildApp.GetMyGuild{Guilds: pg, Wars: pg, Clock: clock}
	get := &guildApp.GetGuild{Guilds: pg, Wars: pg, Clock: clock}
	war := &guildApp.GetWar{Guilds: pg, Wars: pg, Clock: clock}
	contribute := &guildApp.Contribute{
		Guilds: pg, Wars: pg, Judge0: judge0,
		GetWar: war, Clock: clock, Log: d.Log,
	}
	onMatch := &guildApp.OnMatchCompleted{Guilds: pg, Log: d.Log}
	server := guildPorts.NewGuildServer(myGuild, get, war, contribute, d.Log)

	connectPath, connectHandler := druz9v1connect.NewGuildServiceHandler(server)
	transcoder := mustTranscode("guild", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/guild/my", transcoder.ServeHTTP)
			r.Get("/guild/{guildId}", transcoder.ServeHTTP)
			r.Get("/guild/{guildId}/war", transcoder.ServeHTTP)
			r.Post("/guild/{guildId}/war/contribute", transcoder.ServeHTTP)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) { guildApp.SubscribeHandlers(b, onMatch) },
		},
	}
}
