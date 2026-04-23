package services

import (
	"context"

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
	kv := profileInfra.NewRedisKV(d.Redis)
	cached := profileInfra.NewCachedRepo(
		pg,
		kv,
		profileInfra.DefaultProfileCacheTTL,
		d.Log,
	)
	getReport := &profileApp.GetReport{Repo: cached}
	// /profile/me/report — собирает несколько SQL-агрегатов; отдельный 5-мин
	// Redis-кеш окупается при любой нагрузке. Инвалидация ниже триггерится
	// событиями MatchCompleted / XPGained.
	reportCache := profileInfra.NewReportCache(
		getReport.Do, kv, profileInfra.DefaultReportCacheTTL, d.Log,
	)
	h := profilePorts.NewHandler(profilePorts.Handler{
		GetProfile:     &profileApp.GetProfile{Repo: cached},
		GetPublic:      &profileApp.GetPublic{Repo: cached},
		GetAtlas:       &profileApp.GetAtlas{Repo: cached},
		GetReport:      getReport,
		GetSettings:    &profileApp.GetSettings{Repo: cached},
		UpdateSettings: &profileApp.UpdateSettings{Repo: cached},
		ReportFetcher:  reportCache,
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
				// Invalidate cached weekly report when underlying activity
				// changes — match end или прирост XP/level. Без этого фронт
				// видел бы 5-минутный устаревший отчёт после нового матча.
				b.Subscribe(sharedDomain.MatchCompleted{}.Topic(), func(ctx context.Context, e sharedDomain.Event) error {
					ev, ok := e.(sharedDomain.MatchCompleted)
					if !ok {
						return nil
					}
					reportCache.Invalidate(ctx, ev.WinnerID)
					for _, l := range ev.LoserIDs {
						reportCache.Invalidate(ctx, l)
					}
					return nil
				})
				b.Subscribe(sharedDomain.XPGained{}.Topic(), func(ctx context.Context, e sharedDomain.Event) error {
					ev, ok := e.(sharedDomain.XPGained)
					if !ok {
						return nil
					}
					reportCache.Invalidate(ctx, ev.UserID)
					return nil
				})
			},
		},
	}
}
