package services

import (
	podcastApp "druz9/podcast/app"
	podcastInfra "druz9/podcast/infra"
	podcastPorts "druz9/podcast/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
)

// NewPodcast wires the podcast catalog (bible §3.9).
func NewPodcast(d Deps) *Module {
	pg := podcastInfra.NewPostgres(d.Pool)
	signer := podcastInfra.NewFakeSigner("/stream")
	list := podcastApp.NewListCatalog(pg, signer)
	upd := podcastApp.NewUpdateProgress(pg, d.Bus, d.Log)
	server := podcastPorts.NewPodcastServer(list, upd, d.Log)

	connectPath, connectHandler := druz9v1connect.NewPodcastServiceHandler(server)
	transcoder := mustTranscode("podcast", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/podcast", transcoder.ServeHTTP)
			r.Put("/podcast/{podcastId}/progress", transcoder.ServeHTTP)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) { podcastApp.SubscribeHandlers(b) },
		},
	}
}
