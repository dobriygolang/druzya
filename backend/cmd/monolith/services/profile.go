package services

import (
	profileApp "druz9/profile/app"
	profileInfra "druz9/profile/infra"
	profilePorts "druz9/profile/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
)

// NewProfile wires the profile bounded context plus its three cross-domain
// reactors (UserRegistered → bootstrap, XPGained → level up, RatingChanged
// → atlas refresh).
func NewProfile(d Deps) *Module {
	pg := profileInfra.NewPostgres(d.Pool)
	h := profilePorts.NewHandler(profilePorts.Handler{
		GetProfile:     &profileApp.GetProfile{Repo: pg},
		GetPublic:      &profileApp.GetPublic{Repo: pg},
		GetAtlas:       &profileApp.GetAtlas{Repo: pg},
		GetReport:      &profileApp.GetReport{Repo: pg},
		GetSettings:    &profileApp.GetSettings{Repo: pg},
		UpdateSettings: &profileApp.UpdateSettings{Repo: pg},
		Log:            d.Log,
	})
	server := profilePorts.NewProfileServer(h)

	onUserRegistered := &profileApp.OnUserRegistered{Repo: pg, Log: d.Log}
	onXPGained := &profileApp.OnXPGained{Repo: pg, Bus: d.Bus, Log: d.Log}
	onRatingChanged := &profileApp.OnRatingChanged{Repo: pg, Log: d.Log}

	connectPath, connectHandler := druz9v1connect.NewProfileServiceHandler(server)
	transcoder := mustTranscode("profile", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/profile/me", transcoder.ServeHTTP)
			r.Get("/profile/me/atlas", transcoder.ServeHTTP)
			r.Get("/profile/me/report", transcoder.ServeHTTP)
			r.Put("/profile/me/settings", transcoder.ServeHTTP)
			r.Get("/profile/{username}", transcoder.ServeHTTP)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) {
				b.Subscribe(sharedDomain.UserRegistered{}.Topic(), onUserRegistered.Handle)
				b.Subscribe(sharedDomain.XPGained{}.Topic(), onXPGained.Handle)
				b.Subscribe(sharedDomain.RatingChanged{}.Topic(), onRatingChanged.Handle)
			},
		},
	}
}
