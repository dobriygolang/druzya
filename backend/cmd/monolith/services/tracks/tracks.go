// Package tracks wires the curated learning-tracks bounded context
// into the monolith.
package tracks

import (
	monolithServices "druz9/cmd/monolith/services"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	tracksApp "druz9/tracks/app"
	tracksInfra "druz9/tracks/infra"
	tracksPorts "druz9/tracks/ports"

	"github.com/go-chi/chi/v5"
)

// NewTracks wires the bounded context.
func NewTracks(d monolithServices.Deps) *monolithServices.Module {
	repo := tracksInfra.NewPostgres(d.Pool)
	server := tracksPorts.NewServer(
		&tracksApp.ListCatalog{Catalog: repo},
		&tracksApp.GetTrack{Catalog: repo},
		&tracksApp.ListUserTracks{Members: repo},
		&tracksApp.JoinTrack{Members: repo},
		&tracksApp.AdvanceStep{Catalog: repo, Members: repo},
		&tracksApp.PauseTrack{Members: repo},
		&tracksApp.LeaveTrack{Members: repo},
		d.Log,
	)
	connectPath, connectHandler := druz9v1connect.NewTracksServiceHandler(server)
	transcoder := monolithServices.MustTranscode("tracks", connectPath, connectHandler)
	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// /tracks (catalogue read) is auth-required at the chain level
			// because catalogue cards show "joined / not joined" — without
			// auth there's no user-context to render. If a public preview
			// is needed later, lift to MountPublicREST and split the use
			// cases that require auth.
			r.Get("/tracks", transcoder.ServeHTTP)
			r.Get("/tracks/me", transcoder.ServeHTTP)
			r.Get("/tracks/{slug}", transcoder.ServeHTTP)
			r.Post("/tracks/{track_id}/join", transcoder.ServeHTTP)
			r.Post("/tracks/{track_id}/advance", transcoder.ServeHTTP)
			r.Post("/tracks/{track_id}/pause", transcoder.ServeHTTP)
			r.Post("/tracks/{track_id}/leave", transcoder.ServeHTTP)
		},
	}
}
