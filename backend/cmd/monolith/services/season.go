package services

import (
	seasonApp "druz9/season/app"
	seasonInfra "druz9/season/infra"
	seasonPorts "druz9/season/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
)

// NewSeason wires the Season Pass bounded context (bible §3.8).
//
// ClaimReward is constructed but has no HTTP route yet — kept here so the
// migration is byte-equivalent to the pre-refactor file.
func NewSeason(d Deps) *Module {
	pg := seasonInfra.NewPostgres(d.Pool)
	tiers := seasonInfra.NewStaticTiers()
	challenges := seasonInfra.NewStaticChallenges()
	// Persistent ClaimRepo: идемпотентные вставки на уникальном индексе
	// (user_id, season_id, kind, tier). Заменяет in-memory memClaimStore,
	// который ломался при horizontal-scale (два инстанса API → дубли
	// наград) и имел TOCTOU даже внутри одного процесса.
	claims := seasonInfra.NewClaimStore(d.Pool)
	getCurrent := seasonApp.NewGetCurrent(pg, tiers, challenges, claims)
	_ = seasonApp.NewClaimReward(pg, tiers, claims) // no HTTP route yet
	onXP := seasonApp.NewOnXPGained(pg, tiers, d.Bus, d.Log)
	onWin := seasonApp.NewOnMatchCompleted(pg, tiers, d.Bus, d.Log)
	onKata := seasonApp.NewOnDailyKataCompleted(pg, tiers, d.Bus, d.Log)
	onMock := seasonApp.NewOnMockSessionFinished(pg, tiers, d.Bus, d.Log)
	server := seasonPorts.NewSeasonServer(getCurrent, d.Log)

	connectPath, connectHandler := druz9v1connect.NewSeasonServiceHandler(server)
	transcoder := mustTranscode("season", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/season/current", transcoder.ServeHTTP)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) {
				seasonApp.SubscribeHandlers(b, onXP, onWin, onKata, onMock)
			},
		},
	}
}
