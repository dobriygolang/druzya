package services

import (
	profileApp "druz9/profile/app"
	profileInfra "druz9/profile/infra"
	profilePorts "druz9/profile/ports"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
)

// NewProfile wires the profile bounded context plus its three cross-domain
// reactors (UserRegistered → bootstrap, XPGained → level up, RatingChanged
// → atlas refresh).
//
// Read paths are wrapped in a Redis read-through cache (CachedRepo). Writes
// flow through the same wrapper so invalidation happens automatically: every
// XP delta, career-stage update, settings update, or EnsureDefaults call
// busts the cached bundle for that user. Event handlers receive the cached
// repo for the same reason.
func NewProfile(d Deps) *Module {
	pg := profileInfra.NewPostgres(d.Pool)
	cached := profileInfra.NewCachedRepo(
		pg,
		profileInfra.NewRedisKV(d.Redis),
		profileInfra.DefaultProfileCacheTTL,
		d.Log,
	)
	h := profilePorts.NewHandler(profilePorts.Handler{
		GetProfile:     &profileApp.GetProfile{Repo: cached},
		GetPublic:      &profileApp.GetPublic{Repo: cached},
		GetAtlas:       &profileApp.GetAtlas{Repo: cached},
		GetReport:      &profileApp.GetReport{Repo: cached},
		GetSettings:    &profileApp.GetSettings{Repo: cached},
		UpdateSettings: &profileApp.UpdateSettings{Repo: cached},
		Log:            d.Log,
	})
	server := profilePorts.NewProfileServer(h)

	onUserRegistered := &profileApp.OnUserRegistered{Repo: cached, Log: d.Log}
	onXPGained := &profileApp.OnXPGained{Repo: cached, Bus: d.Bus, Log: d.Log}
	onRatingChanged := &profileApp.OnRatingChanged{Repo: cached, Log: d.Log}

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
