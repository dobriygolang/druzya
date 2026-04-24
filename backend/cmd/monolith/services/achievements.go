package services

import (
	achApp "druz9/achievements/app"
	achInfra "druz9/achievements/infra"
	achPorts "druz9/achievements/ports"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
)

// NewAchievements wires the achievements bounded context — каталог в коде
// (см. achievements/domain/catalogue.go), per-user state в Postgres
// (user_achievements, миграция 00015), кеш List в Redis. Подписки слушают
// то, что arena/daily/profile/rating уже публикуют — никаких новых publish-points.
//
// Все три REST-endpoint'а живут под /api/v1, auth required.
func NewAchievements(d Deps) *Module {
	pg := achInfra.NewPostgres(d.Pool)
	kv := achInfra.NewRedisKV(d.Redis)
	cached := achInfra.NewCachedRepo(pg, kv, achInfra.DefaultListTTL, d.Log)
	state := achInfra.NewStateProvider(d.Pool)

	listUC := &achApp.ListAchievements{Repo: cached}
	getUC := &achApp.GetSingle{Repo: cached}
	eval := &achApp.Evaluator{Repo: cached, Log: d.Log, Now: d.Now, State: state}

	subs := &achApp.Subscribers{Eval: eval, Log: d.Log}

	h := achPorts.NewHandler(achPorts.Handler{
		List:      listUC,
		Get:       getUC,
		Evaluator: eval,
		Log:       d.Log,
	})

	return &Module{
		MountREST: func(r chi.Router) {
			h.Mount(r)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) {
				b.Subscribe(sharedDomain.MatchCompleted{}.Topic(), subs.OnMatchCompleted)
				b.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), subs.OnDailyKataCompleted)
				b.Subscribe(sharedDomain.DailyKataMissed{}.Topic(), subs.OnDailyKataMissed)
				b.Subscribe(sharedDomain.XPGained{}.Topic(), subs.OnXPGained)
				b.Subscribe(sharedDomain.RatingChanged{}.Topic(), subs.OnRatingChanged)
				b.Subscribe(sharedDomain.LevelUp{}.Topic(), subs.OnLevelUp)
				b.Subscribe(sharedDomain.GuildWarFinished{}.Topic(), subs.OnGuildWarFinished)
				b.Subscribe(sharedDomain.CohortGraduated{}.Topic(), subs.OnCohortGraduated)
			},
		},
	}
}
